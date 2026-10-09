// What the passbook reader read -> a Statement, through engine/lines.js (the
// same rules as any line-by-line source). A passbook prints no totals, no
// count and no closing balance, so the chain is the only proof and the last
// line is always listed to check by hand.
import { linesStatement } from '../engine/lines.js';
import { cents } from './reader.js';

export { LAST_LINE, PAGE_LINK } from '../engine/lines.js';

// "25/05/68" -> 2025-05-25: a passbook prints the Buddhist year in two digits.
export function passbookDate(text) {
  const m = /^(\d\d)\/(\d\d)\/(\d\d)$/.exec(text ?? '');
  if (!m) return null;
  const [d, mo, y] = [+m[1], +m[2], 2500 + +m[3] - 543];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}
const dmy = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// A date digit that only just beat the next-best symbol is listed to check
// (measured on the Krungthai passbook: every wrong date scored under 0.05 or
// went backwards; 2 of 81 right dates also fall under it).
export const DATE_SURE = 0.05;

/**
 * @param lines what readPassbook returned, in page and line order
 * @param printer the printer profile (key, bank)
 * @param account the account number, as typed from the passbook's cover (or null)
 */
export function passbookStatement(name, lines, printer, { account = null } = {}) {
  const profile = { key: printer.key, bank: printer.bank, remarkFields: ['description'], amountSplitX: null, untested: false };
  let opening = null;
  let body = lines;
  // A brought-forward line (a balance, no amount) opens the book.
  if (lines.length && lines[0].amount === null && lines[0].balance !== null) {
    opening = cents(lines[0].balance);
    body = lines.slice(1);
  }
  const normal = body.map(l => {
    const date = passbookDate(l.date);
    return {
      page: l.page, line: l.line, where: `page ${l.page} line ${l.line}`,
      description: `Passbook p.${l.page} line ${l.line}`,
      amount: l.amount ? cents(l.amount) : null, sign: l.amount ? l.amount[0] : null,
      balance: l.balance ? cents(l.balance) : null,
      date,
      dateNote: date && l.dateMargin !== null && l.dateMargin !== undefined && l.dateMargin < DATE_SURE
        ? `the reader was unsure of the date (reads ${dmy(date)}) - check the date` : null,
    };
  });
  const statement = linesStatement(name, normal, profile, { opening, account });
  statement.passbook = true;
  return statement;
}
