// Lines read by something other than our own bank-PDF reader (a passbook scan,
// a spreadsheet made from a picture) -> a Statement the engine checks like
// any other. The reading is never trusted: the balance chain proves each line,
// and a line goes to Express only when its own amount agrees with the balance
// AND the next line chains on from it (the last line: only when a closing
// balance was given and matches). Every doubtful line is listed, with why.
import { Statement } from './statement.js';
import { Row } from './extract.js';
import { classifyAndVerify, buildChecks } from './verify.js';
import { fmtMoney } from './money.js';

export const LAST_LINE = 'Last line confirmed by a later line';
export const PAGE_LINK = 'Each page carries on from the one before';
export const REPEATS = 'No rows repeated from an earlier file';
export const LINKED = 'Every line linked to a balance typed in';
export const FIRST_LINE = 'First line confirmed by the opening balance typed in';
const dmy = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * @param lines [{ page, line, where, date (ISO or null), dateNote, amount (satang, unsigned, or null),
 *   sign ('+', '-' or null: which way the source says it went), balance (satang or null), description }]
 * @param opening the brought-forward balance, or null to work it back from the first line
 * @param closing the closing balance printed on the source, or null
 */
export function linesStatement(name, lines, profile, { opening = null, closing = null, account = null, pageWord = 'page', typedOpening, holdBrokenPages = false } = {}) {
  const rows = lines.map(l => {
    const r = new Row();
    Object.assign(r, { page: l.page, line: l.line, description: l.description ?? '', printedSign: l.sign ?? null });
    r.amount = l.amount;
    r.balance = l.balance;
    r.date = l.date ?? '';
    for (const n of l.notes ?? []) r.notes.push(n);
    if (r.amount === null && r.balance === null) r.notes.push(`nothing on this line could be read (${l.where}) - type it from the original`);
    else if (r.amount === null) r.notes.push(`the amount could not be read (${l.where}) - type it from the original`);
    else if (r.balance === null) r.notes.push(`the balance could not be read (${l.where}) - check it against the original`);
    if (l.dateNote) { r.notes.push(l.dateNote); r.dateDoubt = true; }
    return r;
  });

  // The same date, amount and balance twice: one picture's rows read again.
  const seen = new Map();
  for (const r of rows) {
    if (!r.date || r.amount === null || r.balance === null) continue;
    const key = `${r.date}|${r.amount}|${r.balance}`;
    const first = seen.get(key);
    // (worded without "date": a note naming the date marks a date doubt below - G8 re-review)
    if (first) r.notes.push(`the same day, amount and balance as ${pageWord} ${first.page} line ${first.line} - a repeated picture? check it`);
    else seen.set(key, r);
  }

  let openingDerived = false, openingTyped = false;
  // No brought-forward line read, but one typed from the original: that IS the
  // opening, and line 1 is checked against it like any other line.
  if (opening === null && typedOpening !== null && typedOpening !== undefined) {
    opening = typedOpening;
    openingTyped = true;
  }
  if (opening === null) {
    // No brought-forward line read: work the opening back from line 1 ONLY -
    // which then has nothing before it to be checked against. Worked back from
    // a later line, that line's amount would "prove" itself (G8 review).
    const first = rows[0];
    opening = first && first.amount !== null && first.balance !== null
      ? first.balance - (first.printedSign === '-' ? -first.amount : first.amount) : 0;
    openingDerived = true;
  }

  const closingComputed = classifyAndVerify(opening, rows, { amountSplitX: null });
  if (openingDerived && rows.length) {
    rows[0].verified = false;
    rows[0].notes.push('the first line has nothing before it to be checked against - check it against the original');
  }

  // The source's own + / - (or its withdrawal / deposit column) is a second
  // opinion on the direction the balance proved.
  for (const r of rows) {
    if (!r.verified || !r.printedSign) continue;
    const said = r.printedSign === '-' ? 'withdrawal' : 'deposit';
    const proved = r.withdrawal !== null ? 'withdrawal' : 'deposit';
    if (said !== proved) r.notes.push(`shown as a ${said} but the balance says ${proved} - check this line`);
  }

  // Dates are not proved by money: one that goes back before the line above is listed.
  // A date that goes backwards: this line, or the one above read too late -
  // both are listed (G8 review: a late misread must not slip through).
  // A date already in doubt (the reader was unsure of it, or it reads either
  // way) is still compared, and still counts for the lines after it: it is
  // often the very line that shows a neighbour's confidently misread date
  // going backwards (G8 picture-v2 re-review). The cost is some extra lines
  // to check when the doubtful date was itself read too late - the safe side.
  // Every line above that reads later than a line going backwards may be the
  // one read too late - not only the line just above: two late misreads in a
  // row, or a late misread above an unsure date, would otherwise slip through
  // (G8 picture-v2 review 3). The lines kept in order only ever go up, so the
  // walk back stops at the first that is not later.
  const kept = [];
  for (const r of rows) {
    if (!r.date) { if (!r.dateDoubt) r.notes.push('the date could not be read - check it against the original'); r.dateDoubt = true; continue; }
    if (kept.length && r.date < kept[kept.length - 1].date) {
      // named: the line it is compared with is the latest date kept, not always the line just above (G8 review 4 N2)
      const top = kept[kept.length - 1];
      r.notes.push(`the date reads ${dmy(r.date)}, earlier than ${pageWord} ${top.page} line ${top.line} above (${dmy(top.date)}) - check the date`);
      r.dateDoubt = true;
      for (let k = kept.length - 1; k >= 0 && kept[k].date > r.date; k--) {
        const above = kept[k];
        // name the line that reads earlier: fixing a misread date there clears these
        if (!above.notes.some(n => n.includes('may be read too late'))) {
          above.notes.push(`its date (${dmy(above.date)}) may be read too late: ${pageWord} ${r.page} line ${r.line} below reads earlier (${dmy(r.date)}) - check both dates`);
        }
        above.dateDoubt = true;
      }
      continue;
    }
    kept.push(r);
  }

  const dates = rows.filter(r => r.date && r.ok).map(r => r.date).sort();
  const facts = {
    account_no: account || null, account_name: null, branch: null,
    period_from: dates.length ? dmy(dates[0]) : null, period_to: dates.length ? dmy(dates[dates.length - 1]) : null,
    closing_stated: closing, withdraw_total: null, withdraw_count: null, deposit_total: null, deposit_count: null,
    opening_derived: openingDerived,
  };
  // The period IS these lines' own dates, so "dated outside the period" says nothing here.
  const checks = buildChecks(opening, rows, closingComputed, facts).filter(([label]) => !label.startsWith('Rows dated outside'));

  // A missing or out-of-order page breaks the chain where two pages meet.
  const joins = [];
  const brokenPages = new Set();
  // Overlapping pictures can chain cleanly (an in 500 / out 500 pair), and a
  // misread date hides the repeat: any row whose amount AND balance appear on an
  // earlier page holds its whole page (G8 re-review).
  const earlier = new Map(), repeatPages = new Set();
  for (const r of rows) {
    if (r.amount === null || r.balance === null) continue;
    const key = `${r.amount}|${r.balance}`;
    const page = earlier.get(key);
    if (page === undefined) earlier.set(key, r.page);
    else if (page !== r.page) { brokenPages.add(r.page); repeatPages.add(r.page); }
  }
  rows.forEach((r, i) => {
    if (i && r.page !== rows[i - 1].page && !r.verified) { joins.push(`${pageWord} ${rows[i - 1].page} -> ${r.page}`); brokenPages.add(r.page); }
  });
  checks.push([PAGE_LINK, !joins.length, joins.length
    ? `the chain breaks where these meet - one missing, out of order, or a misread line: ${joins.join(', ')}`
    : `every ${pageWord} follows on`]);
  if (holdBrokenPages) {
    const repeated = [...repeatPages];
    checks.push([REPEATS, !repeated.length, repeated.length
      ? `${pageWord} ${repeated.join(', ')} repeat${repeated.length === 1 ? 's' : ''} rows of an earlier ${pageWord} (overlapping pictures?) - nothing from ${repeated.length === 1 ? 'it' : 'them'} is sent`
      : `no ${pageWord} repeats another`]);
  }
  // Line 1 is checked against the opening, which was only read - unless a
  // person typed it from the original and it agrees. Only a card with that box
  // (the Excel card) asks: undefined means there is no box to type into.
  let openingConfirmed = false;
  if (typedOpening !== null && typedOpening !== undefined) {
    // Worked back from line 1 or read: either way, agreeing with the original proves it.
    // A typed 0 proves nothing about direction: an overdrawn stretch read without
    // its minus signs also starts from 0 (G8 review 3).
    openingConfirmed = typedOpening === opening && typedOpening !== 0;
    checks.push([FIRST_LINE, openingConfirmed, typedOpening === 0
      ? 'an opening of 0.00 cannot show which way the lines go (an overdrawn account read without its minus signs also starts at 0), so every line is listed to check by hand - type the closing balance too if it is not 0'
      : openingTyped
      ? `no brought-forward line was read, so the ${fmtMoney(typedOpening)} typed in is the opening`
      : `typed ${fmtMoney(typedOpening)}, ${openingDerived ? 'worked back from the first line' : 'read'} ${fmtMoney(opening)}`]);
  } else if (typedOpening === null && rows.length) {
    checks.push([FIRST_LINE, false, 'no opening balance typed in, so the first line is listed to check by hand']);
  }
  if (closing === null) {
    const tail = rows[rows.length - 1];
    checks.push([LAST_LINE, false, tail
      ? `nothing comes after ${pageWord} ${tail.page} line ${tail.line} (balance ${tail.balance === null ? 'not read' : fmtMoney(tail.balance)}), so it is listed to check by hand`
      : 'no lines']);
  }

  const statement = new Statement(name, profile, facts, opening, rows, closingComputed, checks);
  statement.fromPhoto = true;       // read from a picture, by us or another tool: never better than yellow
  statement.perLine = true;         // every doubtful line is listed on its own (engine/statement.js)
  statement.openingConfirmed = openingConfirmed;
  if (holdBrokenPages) statement.heldPages = brokenPages;
  // Where a typed balance is offered (the Excel card), a line counts as proved
  // only when an unbroken run of proved lines links it to a typed balance that
  // matched. A stretch of an overdrawn account read without its minus signs is
  // a perfect mirror image: it chains with itself, and joins the true chain
  // only across a balance of exactly 0 or a line that does not chain - so both
  // break the run (G8 review 3).
  if (typedOpening !== undefined) {
    const linked = new Set();
    const link = i => rows[i].verified && rows[i - 1].balance !== 0;      // row i-1 -> row i
    if (openingConfirmed && rows.length && rows[0].verified) {
      for (let i = 0; i < rows.length && (i === 0 || link(i)); i++) linked.add(i);
    }
    const closingOk = closing !== null && closing !== 0 && checks.some(([label, ok]) => /^Final balance matches/.test(label) && ok);
    if (closingOk && rows.length) {
      for (let i = rows.length - 1; i >= 0; i--) { linked.add(i); if (i === 0 || !link(i)) break; }
    }
    statement.linkedRows = linked;
    // A line not linked is a failing check, so a statement whose every other
    // check passes still goes partial instead of sending all its lines (G8 review 4).
    if (rows.length) {
      const loose = rows.length - linked.size;
      statement.checks.push([LINKED, !loose, loose
        ? `${loose} line(s) not linked to the opening or closing balance typed in by an unbroken run of proved lines`
        : 'every line is linked to a balance typed in']);
    }
  }
  // A balance a person typed from the original that DISAGREES with the reading
  // says the reading itself is wrong - for example every minus sign lost, which
  // the chain alone cannot see: then nothing goes (G8 Excel review B1).
  if (typedOpening !== undefined) {
    // Nothing typed at all: nothing tells a mirror-image reading apart, so nothing goes.
    statement.contradicted = (typedOpening === null && closing === null) ||
      (typedOpening !== null && !openingConfirmed) ||
      (closing !== null && checks.some(([label, ok]) => /^Final balance matches/.test(label) && !ok));
  }   // engine/statement.js confirmed()
  return statement;
}
