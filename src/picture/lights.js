// Traffic lights for the tables read from statement pictures: a light and a
// reason on every row, one light for the whole set. The checks are the Excel
// card's own (table/statement.js -> engine/lines.js), run on the cells as
// they stand now - a cell fixed by hand is checked again, nothing is re-read.
import { tableStatement } from '../table/statement.js';
import { confirmed } from '../engine/statement.js';

// Every picture is put into one column order first, from its own column roles:
// picture 2 may have been read with a column more or less than picture 1.
const ROLES = ['date', 'description', 'withdrawal', 'deposit', 'amount', 'amount2', 'balance'];
const HEADING = ['Date', 'Description', 'Withdrawal', 'Deposit', 'Amount', 'Amount', 'Balance'];
const MAP = Object.fromEntries(ROLES.map((role, i) => [role, i]));

// A row the balance proves can be green; the whole set stays at most yellow,
// because a picture can always be misread (as the photos card).
// [CO-DECIDED 2026-10-09]
export const SET_AT_MOST = 'yellow';
const WORSE = { green: 0, yellow: 1, red: 2 };

/**
 * @param tables [{ name, rows (row 0 = headings), map, dayFirst } | { name, error }] in page order
 * @returns {{ set: { light, headline, counts }, warnings: { en, th }[] (said, never acted on),
 *   rows: ({ light, why } | null)[][] per table and row,
 *   checks: { label, passed, detail }[], statement }}  - rows[k][0] (the heading) is always null; a row
 *   that is not a transaction line (brought forward, totals, text only) has light 'none'; a line's
 *   `at` is its place in `statement.rows` (the checked statement, for Convert to Express)
 */
export function pictureLights(tables, { openingText = '', closingText = '', name = 'pictures', account = null } = {}) {
  const rows = tables.map(t => (t.rows ?? []).map(() => null));
  const counts = { green: 0, yellow: 0, red: 0 };
  const checks = [];
  const broken = t => t.error || !Array.isArray(t.rows) || !t.rows.length;
  tables.forEach((t, k) => {
    if (broken(t)) checks.push({ label: `Picture ${k + 1} read`, passed: false, detail: `${t.name}: ${t.error ?? t.reason ?? 'no table was read'}` });
  });
  const read = tables.map((t, k) => ({ t, k })).filter(({ t }) => !broken(t));
  const pic = p => (read[p - 1] ? read[p - 1].k + 1 : p);
  const say = text => String(text)
    .replace(/file (\d+) (?:row|line) (\d+)/g, (_, p, n) => `picture ${pic(p)} line ${n - 1}`)
    .replace(/file (\d+)/g, (_, p) => `picture ${pic(p)}`)
    .replace(/\bfiles\b/g, 'pictures');
  if (!read.length) {
    return { set: { light: 'red', headline: 'No table was read from these pictures', counts }, warnings: [], rows, checks };
  }

  // The description is every text column on the line, joined (times left out):
  // "ยอดยกมา" or "Total" may sit in a column other than the widest one.
  const TIME = /^\d{1,2}[:.]\d{2}(:\d{2})?$/;
  const canonical = t => {
    const used = new Set(Object.entries(t.map ?? {}).filter(([role]) => role !== 'description').map(([, c]) => c));
    return r => ROLES.map(role => (role === 'description'
      ? r.filter((c, i) => !used.has(i) && c && !TIME.test(c.trim())).join(' ')
      : t.map?.[role] === undefined ? '' : r[t.map[role]] ?? ''));
  };
  // A page with nothing of its own to show the date order (page 2 has no bank
  // title) takes it from the pages before it in the set - unless its own dates
  // only make sense month-first. A page that does not carry on from the one
  // before is held whole by the engine (table/statement.js), so a page from
  // another statement cannot borrow its way to green.
  let carried = false;
  const dayFirstOf = read.map(({ t }) => {
    const own = t.dateEvidence === 'month' ? false : t.dayFirst || (t.dateEvidence !== 'month' && carried);
    carried = t.dateEvidence === 'month' ? false : own;
    return own;
  });
  // A doubt the reader had about a date stands while the date reads as it was
  // read; once the person changes the date on screen, it is theirs (G8 N5).
  const doubtsOf = t => (t.rows ?? []).map((r, i) => {
    const d = t.doubts?.[i];
    return d && String(r[t.map?.date] ?? '').trim() === d.date ? d.note : null;
  });
  const files = read.map(({ t }, j) => ({
    name: t.name, dayFirst: dayFirstOf[j], doubts: doubtsOf(t),
    rows: [HEADING, ...t.rows.slice(1).map(canonical(t))],
  }));
  const s = tableStatement(name, files, MAP, { openingText, closingText, account });
  const nothingTyped = !String(openingText).trim() && !String(closingText).trim();

  // Lines that are not transactions: say what they were taken for.
  for (const note of s.skipped) {
    const m = /file (\d+) row (\d+): (.*)$/.exec(note);
    if (m && read[m[1] - 1]) rows[read[m[1] - 1].k][m[2] - 1] = { light: 'none', why: m[3] };
  }

  const last = s.rows.length - 1;
  s.rows.forEach((r, i) => {
    const k = read[r.page - 1].k;
    let light, why;
    if (!s.contradicted && confirmed(s, i)) {
      light = 'green'; why = 'proved by the balance';
    } else if (r.amount === null || r.balance === null || (!r.verified && !(i === 0 && s.facts.opening_derived))) {
      light = 'red'; why = r.notes.map(say).join('; ') || 'the balance does not add up';
    } else {
      light = 'yellow';
      why = r.notes.length ? r.notes.map(say).join('; ')
        : s.heldPages?.has(r.page) ? `picture ${k + 1} does not carry on from the picture before it, or repeats its rows - check the order of the pictures`
        : nothingTyped ? 'adds up - type the opening or closing balance from the paper to confirm it'
        : s.contradicted ? 'adds up, but a balance typed in does not match what was read'
        : i > 0 && !s.rows[i - 1].verified ? 'the line before it does not add up, so the balance it starts from is not confirmed'
        : i < last && !s.rows[i + 1].verified ? 'the line after it does not add up, so its balance is not confirmed'
        : i === last && !String(closingText).trim() ? 'nothing comes after it to confirm its balance - type the closing balance'
        : i === 0 && !String(openingText).trim() ? 'nothing before it confirms it - type the opening balance'
        : 'not joined to a balance typed in by an unbroken run of proved lines';
    }
    // A faint "+" read as a "4" ("4250.00" for "+250.00"): when the figure
    // without its first 4 is exactly the change in the balance, say so. Only
    // said, never changed - the person checks the paper [CO-DECIDED 2026-10-09].
    if (light !== 'green') {
      const before = i > 0 ? s.rows[i - 1].balance : s.opening;
      const moved = before !== null && before !== undefined && r.balance !== null ? Math.abs(r.balance - before) : null;
      const digits = r.amount !== null ? String(r.amount) : '';
      if (moved && digits.length > 3 && digits[0] === '4' && Number(digits.slice(1)) === moved) {
        const shown = (moved / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
        why = `${why}; this may be +${shown} with the "+" read as a 4 - the balance agrees with ${shown}; check the paper`;
      }
    }
    // A passbook date filled in from the lines either side, or the same day
    // suggested for a date read otherwise: said while the date reads as then.
    const hint = read[r.page - 1].t.hints?.[r.line - 1];
    const dateNow = String(read[r.page - 1].t.rows[r.line - 1]?.[read[r.page - 1].t.map?.date] ?? '').trim();
    if (hint && dateNow === hint.date) why = `${why}; ${hint.note}`;
    // An amount not read, between two balances that were: the change is said,
    // never filled in - the line stays held [CO-DECIDED 2026-10-09].
    if (r.amount === null && r.balance !== null) {
      const before = i > 0 ? s.rows[i - 1].balance : s.opening;
      if (before !== null && before !== undefined && r.balance !== before) {
        const d = r.balance - before;
        why = `${why}; the balance changed by ${d > 0 ? '+' : '-'}${(Math.abs(d) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} - that may be the amount, if the balance above was read right; type it from the paper`;
      }
    }
    // What the reader itself was unsure of (passbook pages: a date digit that
    // only just beat the next-best symbol) keeps a proved line from green.
    // (the engine holds it from Express too: it is a date note on the line)
    const doubt = files[r.page - 1].doubts[r.line - 1];
    if (doubt && light === 'green') { light = 'yellow'; why = doubt; }
    else if (doubt && !why.includes(doubt)) why = `${why}; ${doubt}`;
    counts[light]++;
    rows[k][r.line - 1] = { light, why, at: i };
  });

  for (const [label, passed, detail] of s.checks) checks.push({ label: say(label), passed, detail: say(detail) });

  // The set: its worst row, then what only the whole set shows.
  const typedWrong = s.contradicted && !nothingTyped;
  let light = counts.red || typedWrong || read.length < tables.length || !s.rows.length ? 'red'
    : counts.yellow ? 'yellow' : 'green';
  if (WORSE[light] < WORSE[SET_AT_MOST]) light = SET_AT_MOST;
  const n = c => `${c} line${c === 1 ? '' : 's'}`;
  const headline = !s.rows.length ? 'No transaction lines were found'
    : read.length < tables.length ? `${tables.length - read.length} picture(s) could not be read`
    : typedWrong ? 'A balance typed in does not match what was read'
    : counts.red ? `${n(counts.red)} with something wrong`
    : counts.yellow ? `${n(counts.yellow)} to look at`
    : 'Every line is proved by the balance - still check it against the paper';
  return { set: { light, headline, counts }, warnings: s.warnings ?? [], rows, checks, statement: s };
}
