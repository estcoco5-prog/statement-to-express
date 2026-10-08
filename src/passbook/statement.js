// What the passbook reader read -> a Statement the engine checks like any
// other: the same balance proof, the same Express and Review files. A passbook
// prints no totals, no count and no closing balance, so the chain is the only
// proof: a line goes to Express only when its own amount agrees with the
// balance AND the next line chains on from it. The last line has nothing after
// it, so it is always listed to check by hand.
import { Statement } from '../engine/statement.js';
import { Row } from '../engine/extract.js';
import { classifyAndVerify, buildChecks } from '../engine/verify.js';
import { fmtMoney } from '../engine/money.js';
import { cents } from './reader.js';

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
const DATE_SURE = 0.05;

export const LAST_LINE = 'Last line confirmed by a later line';
export const PAGE_LINK = 'Each page carries on from the one before';

/**
 * @param lines what readPassbook returned, in page and line order
 * @param printer the printer profile (key, bank)
 * @param account the account number, as typed from the passbook's cover (or null)
 */
export function passbookStatement(name, lines, printer, { account = null } = {}) {
  const profile = { key: printer.key, bank: printer.bank, remarkFields: ['description'], amountSplitX: null, untested: false };
  let opening = null, openingDerived = false;
  let body = lines;
  // A brought-forward line (a balance, no amount) opens the book.
  if (lines.length && lines[0].amount === null && lines[0].balance !== null) {
    opening = cents(lines[0].balance);
    body = lines.slice(1);
  }

  const rows = body.map(l => {
    const r = new Row();
    r.page = l.page;
    r.line = l.line;
    r.description = `Passbook p.${l.page} line ${l.line}`;
    r.amount = l.amount ? cents(l.amount) : null;
    r.balance = l.balance ? cents(l.balance) : null;
    r.printedSign = l.amount ? l.amount[0] : null;
    r.date = passbookDate(l.date) ?? '';
    r.dateMargin = l.dateMargin ?? null;
    if (r.amount === null && r.balance === null) r.notes.push('nothing on this line could be read - type it from the passbook');
    else if (r.amount === null) r.notes.push('the amount on this line could not be read - type it from the passbook');
    else if (r.balance === null) r.notes.push('the balance on this line could not be read - check it against the passbook');
    return r;
  });

  if (opening === null) {
    // No brought-forward line read: work the opening back from line 1 ONLY -
    // which then has nothing before it to be checked against. Worked back from
    // a later line, that line's amount would "prove" itself (G8 review).
    const first = rows[0];
    opening = first && first.amount !== null && first.balance !== null
      ? first.balance - (first.printedSign === '-' ? -first.amount : first.amount) : 0;
    openingDerived = true;
  }

  const closing = classifyAndVerify(opening, rows, profile);
  if (openingDerived && rows.length) {
    rows[0].verified = false;
    rows[0].notes.push('the first line has nothing before it to be checked against - check it against the passbook');
  }

  // The printed + / - is a second opinion on the direction the balance proved.
  for (const r of rows) {
    if (!r.verified || !r.printedSign) continue;
    const said = r.printedSign === '-' ? 'withdrawal' : 'deposit';
    const proved = r.withdrawal !== null ? 'withdrawal' : 'deposit';
    if (said !== proved) r.notes.push(`printed as a ${said} but the balance says ${proved} - check this line`);
  }

  // Dates are not proved by money: one that is not a real date, or goes back
  // before the line above it, is listed to check.
  // A date that goes backwards: this line, or the one above read too late -
  // both are listed (G8 review: a late misread must not slip through).
  let last = null, lastRow = null;
  for (const r of rows) {
    if (r.date && r.dateMargin !== null && r.dateMargin < DATE_SURE) { r.notes.push(`the reader was unsure of the date (reads ${dmy(r.date)}) - check the date`); continue; }
    if (!r.date) { r.notes.push('the date could not be read - check it against the passbook'); continue; }
    if (last && r.date < last) {
      r.notes.push(`the date reads ${dmy(r.date)}, earlier than the line above - check the date`);
      if (lastRow && !lastRow.notes.some(n => n.includes('a later line reads earlier'))) {
        lastRow.notes.push(`its date (${dmy(lastRow.date)}) may be read too late: a later line reads earlier - check the date`);
      }
      continue;
    }
    last = r.date;
    lastRow = r;
  }

  const dates = rows.filter(r => r.date && r.ok).map(r => r.date).sort();
  const facts = {
    account_no: account || null, account_name: null, branch: null,
    period_from: dates.length ? dmy(dates[0]) : null, period_to: dates.length ? dmy(dates[dates.length - 1]) : null,
    closing_stated: null, withdraw_total: null, withdraw_count: null, deposit_total: null, deposit_count: null,
    opening_derived: openingDerived,
  };
  // The period IS the passbook's own dates, so "dated outside the period" says nothing here.
  const checks = buildChecks(opening, rows, closing, facts).filter(([label]) => !label.startsWith('Rows dated outside'));

  // A missing or out-of-order page breaks the chain where two pages meet.
  const joins = [];
  rows.forEach((r, i) => { if (i && r.page !== rows[i - 1].page && !r.verified) joins.push(`page ${rows[i - 1].page} -> ${r.page}`); });
  checks.push([PAGE_LINK, !joins.length, joins.length ? `the chain breaks where these pages meet - a page missing, pages out of order, or a misread line: ${joins.join(', ')}` : 'every page follows on']);
  const tail = rows[rows.length - 1];
  checks.push([LAST_LINE, false, tail
    ? `nothing is printed after page ${tail.page} line ${tail.line} (balance ${tail.balance === null ? 'not read' : fmtMoney(tail.balance)}), so it is listed to check by hand`
    : 'no lines']);

  const statement = new Statement(name, profile, facts, opening, rows, closing, checks);
  statement.fromPhoto = true;       // read from a picture: never better than yellow
  statement.passbook = true;
  return statement;
}
