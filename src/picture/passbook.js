// Passbook pages in Picture -> Excel: when the person ticks "these are passbook
// pages", the pages are read by the Passbook card's own dot-pattern reader
// (passbook/reader.js) instead of the general photo reader, and each page
// becomes a table like any other picture's - the same lights, Why column and
// Download Excel. Pure: the reader's lines in, one table per page out.
import { DATE_SURE } from '../passbook/statement.js';

const HEADING = ['Date', 'Description', 'Amount', 'Balance'];
const sure = l => !!l.date && !(l.dateMargin !== null && l.dateMargin !== undefined && l.dateMargin < DATE_SURE);

// Each line whose nearest dated lines above and below (across pages; not the
// brought-forward line, which a passbook dates when it was carried over) were
// both read surely as the same day -> that day.
function sameDayAround(lines) {
  const body = lines.filter((l, i) => (l.date || l.amount || l.balance) && !(i === 0 && !l.amount && l.balance));
  const out = new Map();
  body.forEach((l, i) => {
    let a = i - 1, b = i + 1;
    while (a >= 0 && !body[a].date) a--;
    while (b < body.length && !body[b].date) b++;
    if (a >= 0 && b < body.length && sure(body[a]) && sure(body[b]) && body[a].date === body[b].date) out.set(l, { date: body[a].date });
  });
  return out;
}

/**
 * @param lines what readPassbook returned, in page and line order
 * @param names the page names, in order
 * @returns tables [{ name, rows, other, map, dayFirst, dateEvidence, doubts, hints } | { name, error, rows: [] }] -
 *   `doubts[r]` = { date, note }: the reader was unsure of row r's date as read (`date`); it holds the
 *   row from green and from Express until the person changes that date on screen.
 *   `hints[r]` = { date, note }: said in the Why column while row r's date reads `date`; never holds.
 */
export function passbookTables(lines, names) {
  const sameDay = sameDayAround(lines);
  return names.map((name, p) => {
    const rows = [HEADING.slice()];
    const doubts = [null], hints = [null];
    for (const l of lines.filter(x => x.page === p + 1)) {
      // a line the reader saw nothing on (an empty line of the page) is not a row
      if (!l.date && !l.amount && !l.balance) continue;
      // The book's first line, a balance with no amount, is the balance brought
      // forward (B/F), as the Passbook card takes it (passbook/statement.js).
      const bf = p === 0 && rows.length === 1 && !l.amount && !!l.balance;
      // the star in front of a printed balance is the printer's mark, not part of the figure
      // A date not read at all, between two lines both read surely as the same
      // day, is filled in with that day: dates never go back, so it can be no
      // other - as sure as those two dates [CO-DECIDED 2026-10-09]. A date that
      // WAS read is never replaced: it may be what shows a neighbour misread
      // (G8 picture-v2 reviews 2-3), so the same day is only suggested.
      const around = sameDay.get(l);
      const fill = !l.date && around ? around.date : null;
      rows.push([fill ?? l.date ?? '', bf ? 'B/F' : '', l.amount ?? '', (l.balance ?? '').replace(/^\*/, '')]);
      const unsure = l.date && l.dateMargin !== null && l.dateMargin !== undefined && l.dateMargin < DATE_SURE;
      doubts.push(unsure ? { date: l.date, note: `the reader was unsure of the date (reads ${l.date}) - check the date` } : null);
      hints.push(fill ? { date: fill, note: `the date could not be read: filled in as ${fill}, the date the lines either side both read - check it against the paper` }
        : around && l.date !== around.date ? { date: l.date, note: `the lines either side both read ${around.date} - it may be ${around.date}; check the paper` }
        : null);
    }
    // a page with nothing read on it is said, not passed on as an empty table (G8 N3)
    if (rows.length === 1) return { name, error: 'nothing was read on this page - check it is a printed passbook page, flat and whole', rows: [], other: [] };
    // A Thai passbook prints its dates day first, with the Buddhist year in two digits.
    return { name, rows, other: [], map: { date: 0, description: 1, amount: 2, balance: 3 }, dayFirst: true, dateEvidence: 'day', doubts, hints, passbook: true };
  });
}
