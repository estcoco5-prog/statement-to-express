// Money as integer satang. Python uses Decimal; integers give the same exact
// arithmetic, and these formatters reproduce Python's text so that every
// message and every Excel cell is identical to the answer key.
export const AMOUNT_RE = /^\d{1,3}(?:,\d{3})*\.\d{2}$|^\d+\.\d{2}$/;

export function parseAmount(token) {
  if (!AMOUNT_RE.test(token)) return null;
  const [whole, frac] = token.replace(/,/g, '').split('.');
  return Number(whole) * 100 + Number(frac);
}

export function fmtMoney(satang) {
  const sign = satang < 0 ? '-' : '';
  const a = Math.abs(satang);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

// Python writes float(7500) as "7500.0"; JS writes "7500". Otherwise the
// shortest round-trip forms agree for every 2-decimal value.
export function pyFloat(satang) {
  const v = satang / 100;
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}
