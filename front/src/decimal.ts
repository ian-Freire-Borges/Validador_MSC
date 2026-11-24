export type Decimal = { units: bigint; scale: number };
export const zero: Decimal = { units: 0n, scale: 0 };

export function decimal(value: string): Decimal {
  const [whole, fraction = ''] = value.split('.');
  let scale = fraction.length;
  while (scale > 0 && fraction[scale - 1] === '0') scale--;
  return { units: BigInt(whole + fraction.slice(0, scale)), scale };
}

export function add(a: Decimal, b: Decimal): Decimal {
  if (a.units === 0n) return b;
  if (b.units === 0n) return a;
  const scale = Math.max(a.scale, b.scale);
  return { units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale };
}

export function negate(value: Decimal): Decimal {
  return { ...value, units: -value.units };
}

export function format(value: Decimal): string {
  const { units, scale } = value;
  if (units === 0n) return '0';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  let end = digits.length;
  const point = digits.length - scale;
  while (end > point && digits[end - 1] === '0') end--;
  const magnitude = end > point ? digits.slice(0, point) + '.' + digits.slice(point, end) : digits.slice(0, point);
  return (units < 0n ? '−' : '') + magnitude;
}
