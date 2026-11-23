export type Encoding = 'UTF-8' | 'Windows-1252';

interface ByteFault {
  offset: number;
  observed: string;
  expected: string;
}

const utf8Bom = [0xef, 0xbb, 0xbf];
const unicodeBoms = [
  [0xff, 0xfe, 0, 0], [0, 0, 0xfe, 0xff], utf8Bom, [0xfe, 0xff], [0xff, 0xfe],
  [0x2b, 0x2f, 0x76, 0x38], [0x2b, 0x2f, 0x76, 0x39], [0x2b, 0x2f, 0x76, 0x2b], [0x2b, 0x2f, 0x76, 0x2f],
  [0xf7, 0x64, 0x4c], [0xdd, 0x73, 0x66, 0x73], [0x0e, 0xfe, 0xff],
  [0xfb, 0xee, 0x28], [0x84, 0x31, 0x95, 0x33],
];
const unassigned = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
const cp1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

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

export function* decodeLines(bytes: Uint8Array, encoding: Encoding): Generator<DecodedLine> {
  const matches = (bom: number[]) => bom.every((byte, index) => byte === bytes[index]);
  if (encoding === 'Windows-1252') {
    const bom = unicodeBoms.find(matches);
    if (bom) {
      yield { number: 1, endByte: bom.length, fault: {
        offset: 0, observed: bom.map(hex).join(' '), expected: 'Windows-1252 sem BOM Unicode',
      } };
      return;
    }
  }
  const decoder = encoding === 'UTF-8' ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }) : null;
  let start = decoder && matches(utf8Bom) ? 3 : 0;
  for (let number = 1; start < bytes.length; number++) {
    const lf = bytes.indexOf(0x0a, start);
    const end = lf < 0 ? bytes.length : lf;
    const endByte = lf < 0 ? end : end + 1;
    const line = bytes.subarray(start, lf >= 0 && bytes[end - 1] === 0x0d ? end - 1 : end);
    let text: string;
    let bad = line.indexOf(0);
    if (decoder) {
      try {
        text = decoder.decode(line);
      } catch {
        const utfFault = invalidUtf8(line);
        if (utfFault !== undefined && (bad < 0 || utfFault < bad)) bad = utfFault;
        text = '';
      }
    } else {
      text = '';
      for (let index = 0; index < line.length; index++) {
        const byte = line[index];
        if (byte === 0 || unassigned.has(byte)) {
          bad = index;
          break;
        }
        text += byte >= 0x80 && byte < 0xa0 ? cp1252[byte - 0x80] : String.fromCharCode(byte);
      }
    }
    if (bad >= 0) {
      yield { number, endByte, fault: {
        offset: start + bad, observed: '0x' + hex(line[bad]),
        expected: encoding === 'UTF-8'
          ? 'UTF-8 válido, sem NUL. Se o arquivo estiver em Windows-1252, selecione essa opção e valide novamente.'
          : 'Windows-1252 com bytes mapeados e sem NUL',
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
