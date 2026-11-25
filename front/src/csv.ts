interface ByteFault {
  offset: number;
  observed: string;
  expected: string;
}

const utf8Bom = [0xef, 0xbb, 0xbf];

function hex(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

function invalidUtf8(bytes: Uint8Array): number | undefined {
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    if (first < 0x80) {
      index++;
      continue;
    }
    const length = first >= 0xc2 && first <= 0xdf ? 2 :
      first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    if (!length || index + length > bytes.length) return index;
    for (let next = 1; next < length; next++) {
      const byte = bytes[index + next];
      const min = next === 1 && first === 0xe0 ? 0xa0 : next === 1 && first === 0xf0 ? 0x90 : 0x80;
      const max = next === 1 && first === 0xed ? 0x9f : next === 1 && first === 0xf4 ? 0x8f : 0xbf;
      if (byte < min || byte > max) return index + next;
    }
    index += length;
  }
  return undefined;
}

export interface DecodedLine {
  number: number;
  endByte: number;
  text?: string;
  fault?: ByteFault;
}

export function* decodeLines(bytes: Uint8Array): Generator<DecodedLine> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let start = utf8Bom.every((byte, index) => byte === bytes[index]) ? utf8Bom.length : 0;
  for (let number = 1; start < bytes.length; number++) {
    const lf = bytes.indexOf(0x0a, start);
    const end = lf < 0 ? bytes.length : lf;
    const endByte = lf < 0 ? end : end + 1;
    const line = bytes.subarray(start, lf >= 0 && bytes[end - 1] === 0x0d ? end - 1 : end);
    let text: string;
    let bad = line.indexOf(0);
    try {
      text = decoder.decode(line);
    } catch {
      const utfFault = invalidUtf8(line);
      if (utfFault !== undefined && (bad < 0 || utfFault < bad)) bad = utfFault;
      text = '';
    }
    if (bad >= 0) {
      yield { number, endByte, fault: {
        offset: start + bad, observed: '0x' + hex(line[bad]),
        expected: 'UTF-8 válido, sem NUL. Reexporte o CSV em UTF-8 e valide novamente.',
      } };
      return;
    }
    yield { number, endByte, text };
    start = endByte;
  }
}

export function parseRecord(line: string): { fields: string[] } |
  { fieldIndex: number; observed: string; expected: string } {
  const fields: string[] = [];
  let field = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  for (const char of line) {
    if (/[\x00-\x1f\x7f]/.test(char)) {
      return { fieldIndex: fields.length + 1, observed: 'U+' + hex(char.charCodeAt(0)), expected: 'Campo sem controles ASCII ou CR isolado' };
    }
    if (char === ';' && state !== 'quoted') {
      fields.push(field);
      field = '';
      state = 'start';
    } else if (char === '"') {
      if (state === 'start') state = 'quoted';
      else if (state === 'quoted') state = 'closed';
      else if (state === 'closed') {
        field += '"';
        state = 'quoted';
      } else {
        return { fieldIndex: fields.length + 1, observed: field + char, expected: 'Aspas apenas no início de campo ou escapadas dentro de aspas' };
      }
    } else if (state === 'closed') {
      return { fieldIndex: fields.length + 1, observed: field + char, expected: 'Delimitador ou fim da linha após aspas de fechamento' };
    } else {
      field += char;
      if (state === 'start') state = 'plain';
    }
  }
  if (state === 'quoted') {
    return { fieldIndex: fields.length + 1, observed: field, expected: 'Campo com aspas fechadas na mesma linha física' };
  }
  fields.push(field);
  return { fields };
}
