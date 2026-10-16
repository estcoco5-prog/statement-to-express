// Step 3 - read the transaction rows.
import { StatementError } from './errors.js';
import { parseAmount, parseSigned, fmtMoney } from './money.js';
import { Word } from './words.js';
import { DATE_RE, TIME_RE, ROW_TOLERANCE, groupIntoRows, rowText, rowY } from './rows.js';
import { D_MON_RE, parseDate, parseDMon } from './dates.js';
import { cellsByColumn } from './header.js';
import { inWithdrawalColumn } from './profiles.js';

export { cellsByColumn };

export class Row {
  constructor() {
    this.date = ''; this.time = '';
    this.description = ''; this.channel = ''; this.details = '';
    this.amount = null;       // as printed, direction not yet known (satang)
    this.amountX1 = null;     // right edge, for the position cross-check
    this.balance = null;
    this.withdrawal = null; this.deposit = null;
    // Withholding tax the bank took from this row (KTB Corporate prints it in
    // its own column). Becomes a separate withdrawal row once verified.
    this.tax = null;
    this.isTax = false;
    this.notes = [];
    // Set only when the running balance confirmed this row - a real flag, so
    // a new kind of warning can never quietly weaken the balance check.
    this.verified = false;
  }
  get ok() { return this.notes.length === 0; }
}

// Catch the row grouping having swallowed two real lines at once.
export function checkRowSanity(buckets, norm = w => w.text) {
  const dates = (buckets.date ?? []).filter(w => DATE_RE.test(norm(w)));
  if (dates.length > 1) {
    throw new StatementError(
      `two dates landed on one line ([${dates.map(w => `'${w.text}'`).join(', ')}]) - the row ` +
      `tolerance of ${ROW_TOLERANCE.toFixed(1)}pt is too generous for this statement`);
  }
}

const has = (text, marks) => (marks ?? []).some(m => text.includes(m));
// In a PDF made from photos the reader drops spaces and slashes ("B/F" read as
// "BF" on BBL photos), so the opening label is compared without them there.
const loose = s => s.replace(/[\s/]+/g, '');
const hasLoose = (text, marks) => (marks ?? []).some(m => loose(text).includes(loose(m)));

export function extractRows(pages, profile, facts) {
  const hasOpening = pages.source === 'photo' ? hasLoose : has;
  // A business form's own date shape ("01.06.2026", "01-มิ.ย.-2569") as dd/mm/yyyy.
  const norm = w => (profile.normDate ? profile.normDate(w.text) : w.text);
  const balanceOf = profile.signedBalances ? parseSigned : parseAmount;
  let opening = null;
  let rows = [];

  for (const [index, words] of pages.entries()) {
    // A summary page (made from photos, e.g. UOB's account overview) gave the
    // header its period; its figures are not transactions.
    if (pages.summaryPages?.has(index)) continue;
    // A wrapped description prints directly beneath its own transaction, so it
    // never crosses a page break: the lines at the top of a new page are that
    // page's header, not a continuation of the last row before it.
    let wrappable = null, wrapY = null;
    // wrapNearest: wrapped lines seen since the last row, given to whichever
    // row turns out nearer - the one above, or the next one below.
    let held = [];
    const settle = (next, nextY) => {
      const before = [];
      for (const h of held) {
        const up = wrappable !== null ? h.y - wrapY : Infinity, down = next !== null ? nextY - h.y : Infinity;
        if (Math.min(up, down) > profile.wrapNearest) continue;     // too far from both: a heading
        if (up <= down) appendWrapped(wrappable, h.buckets, profile); else before.push(h);
      }
      held = [];
      return before;
    };
    for (const line of groupIntoRows(words)) {
      const text = rowText(line);
      const buckets = cellsByColumn(line, profile);

      let dateWords;
      if (profile.dateStyle === 'd_mon') {
        // '01 Sep' is two words; treat the date column as one token.
        const joined = (buckets.date ?? []).map(w => w.text).join(' ');
        dateWords = D_MON_RE.test(joined) ? [new Word(0, 0, 0, 0, joined)] : [];
      } else {
        dateWords = (buckets.date ?? []).filter(w => DATE_RE.test(norm(w)));
      }
      const balances = (buckets.balance ?? []).map(w => [w, balanceOf(w.text)]).filter(([, a]) => a !== null);
      let money = (buckets.amount ?? []).map(w => [w, amountOf(w.text, profile)]).filter(([, a]) => a !== null);
      // A transaction has a date and a balance - or, for a bank that prints the
      // balance only on some rows, a date and an amount.
      const isRow = dateWords.length > 0 &&
        (balances.length > 0 || (!profile.balanceEveryRow && money.length > 0));

      // Page furniture ends the page - but a margin stamp can sit level with a
      // real last row. A line carrying a date and a balance is data.
      if (has(text, profile.marks.footer) && !isRow) break;

      checkRowSanity(buckets, norm);

      // The opening row: a date and a balance, no amount. It repeats at the top
      // of every page as a carry-forward; only the first one counts.
      if (hasOpening(text, profile.marks.opening) && balances.length) {
        if (opening === null) opening = balances[balances.length - 1][1];
        continue;
      }

      if (!isRow) {
        // No date and no balance: a description wrapped onto a second line
        // belongs to the transaction above it, on this page.
        if (profile.wrapNearest !== null) {
          if (!dateWords.length && !balances.length) held.push({ y: rowY(line), buckets });
        } else if (wrappable !== null && !dateWords.length && !balances.length) {
          if (profile.wrapReach !== null && (rowY(line) - wrapY > profile.wrapReach
              || !['description', 'channel', 'details'].some(f =>
                (buckets[f] ?? []).some(w => /[\p{L}\p{N}]/u.test(w.text))))) {
            wrappable = null;               // a gap or a ruled line: the table ended
          } else {
            appendWrapped(wrappable, buckets, profile);
            wrapY = rowY(line);
          }
        }
        continue;
      }

      const before = profile.wrapNearest !== null ? settle(true, rowY(line)) : [];
      const row = new Row();
      // From photos: the page a row came from, so the Review file can say
      // where to check it. Bank PDFs keep exactly the reference's rows.
      if (pages.source === 'photo') row.page = index + 1;
      const [date, warning] = profile.dateStyle === 'd_mon'
        ? parseDMon(dateWords[0].text, facts) : parseDate(norm(dateWords[0]), facts, profile);
      row.date = date;
      if (warning) row.notes.push(warning);
      if (row.date === null) {
        row.date = dateWords[0].text;
        row.notes.push('date could not be read');
      }

      const times = (buckets.time ?? []).map(w => w.text).filter(t => isTime(t, profile));
      row.time = times.length ? times[0] : '';
      row.description = (buckets.description ?? []).map(w => w.text).join(' ');
      row.channel = (buckets.channel ?? []).map(w => w.text).join(' ');
      row.details = (buckets.details ?? []).map(w => w.text).join(' ');
      if (!row.details && profile.codeNames?.[row.description]) row.details = profile.codeNames[row.description];
      row.balance = balances.length ? balances[balances.length - 1][1] : null;
      const taxes = (buckets.tax ?? []).map(w => parseAmount(w.text)).filter(a => a);
      row.tax = taxes.length ? taxes[taxes.length - 1] : null;

      // KTB prints the interest row as "0.00 tax  5.09 interest". A zero moves
      // no money; when a real amount sits beside it, it is not one.
      if (money.length > 1 && money.some(([, a]) => a !== 0)) money = money.filter(([, a]) => a !== 0);
      if (money.length >= 1) {
        row.amount = money[0][1];
        row.amountX1 = money[0][0].x1;
        if (money.length > 1) {
          row.notes.push(`${money.length} amounts found in the amount column ` +
            `(${money.map(([, a]) => fmtMoney(a)).join(', ')}) - used the first`);
        }
      } else {
        row.notes.push('no amount found in the amount column');
      }

      for (const h of before.reverse()) prependWrapped(row, h.buckets);
      rows.push(row);
      wrappable = row; wrapY = rowY(line);
    }
    if (profile.wrapNearest !== null) settle(null, null);    // the page's last row may still own some
  }

  if (profile.leadChannel) for (const row of rows) splitLeadChannel(row);
  if (profile.wrapStrip.length) {
    for (const row of rows) {
      for (const label of profile.wrapStrip) row.description = row.description.split(label).join(' ');
      row.description = row.description.replace(/\s+/g, ' ').trim();
    }
  }

  for (const row of rows) flagFurniture(row, profile);

  if (profile.newestFirst) rows = oldestFirst(rows);

  if (opening === null && !profile.openingPrinted && rows.length) opening = deriveOpening(rows[0], profile, facts);

  if (opening === null) {
    throw new StatementError(
      `the opening balance row (${profile.marks.opening.join('/')}) was not found - without it ` +
      'the balance chain has no starting point');
  }
  return { opening, rows };
}

// An amount as printed. A bank that prints debits with a minus gets the sign
// dropped: the running balance decides the direction, never the sign.
function amountOf(token, profile) {
  return parseAmount(profile.signedAmounts && token.startsWith('-') ? token.slice(1) : token);
}

const isTime = (token, profile) => TIME_RE.test(token) || (profile.timeSeconds && /^\d{1,2}:\d{2}:\d{2}$/.test(token));

// Turn a newest-first listing oldest-first - only when every readable date runs
// newest-first. A date going the other way means the order is not what the
// bank's form says, and the file is refused rather than guessed at.
function oldestFirst(rows) {
  const dates = rows.map(r => r.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ''));
  const later = dates.slice(1).map((b, i) => [dates[i], b]).filter(([a, b]) => b > a);
  if (later.length) {
    throw new StatementError(
      `this report lists its newest line first, but ${later.length} date(s) go the other ` +
      `way (first: ${later[0][0]} then ${later[0][1]}) - the order cannot be trusted`);
  }
  return rows.slice().reverse();
}

// Catch page furniture that leaked into a transaction's text. The balance
// chain proves the money and nothing else - it cannot see the descriptions.
export function flagFurniture(row, profile) {
  const text = [row.description, row.channel, row.details].filter(Boolean).join(' ');
  const found = profile.marks.furniture_text.filter(m => text.includes(m));
  if (found.length) {
    row.notes.push(
      `page furniture leaked into this row's text (${found.join(', ')}) - the amounts are ` +
      'still proved by the balance, but the description is not trustworthy');
  }
}

// For a bank that prints no brought-forward line: work the opening back from
// the first row. The bank's printed totals are what confirm it.
function deriveOpening(first, profile, facts) {
  if (first.balance === null || first.amount === null || first.amountX1 === null) return null;
  const wentOut = inWithdrawalColumn(first.amountX1, profile);
  facts.opening_derived = true;
  return wentOut ? first.balance + first.amount : first.balance - first.amount;
}

export const isThai = ch => ch >= '฀' && ch <= '๿';

// Glue a wrapped continuation line onto the transaction it belongs to.
export function appendWrapped(row, buckets, profile = null) {
  if (!row.time) {
    // KTB prints the time on the line under the date (UOB Business: with seconds).
    for (const w of [...(buckets.date ?? []), ...(buckets.time ?? [])]) {
      if (profile ? isTime(w.text, profile) : TIME_RE.test(w.text)) { row.time = w.text; break; }
    }
  }
  for (const field of ['description', 'channel', 'details']) {
    const extra = (buckets[field] ?? []).map(w => w.text).join(' ');
    if (extra) {
      const before = row[field];
      // Thai puts no spaces between words, so a Thai phrase the bank wrapped
      // mid-way (KKP: ต่าง / ธนาคาร) is glued back as one.
      const glue = before && isThai(before[before.length - 1]) && isThai(extra[0]) ? '' : ' ';
      row[field] = (before + glue + extra).trim();
    }
  }
}

// A wrapped line printed ABOVE its transaction (SCB Business): its text goes first.
function prependWrapped(row, buckets) {
  for (const field of ['description', 'channel', 'details']) {
    const extra = (buckets[field] ?? []).map(w => w.text).join(' ');
    if (extra) row[field] = `${extra} ${row[field]}`.trim();
  }
}

// "business one Transfer out via business one KKB X5077 ..." (ttb): the channel
// printed first is said again inside the description - it becomes the channel,
// so the 50 characters Express keeps hold the other party, not the channel twice.
function splitLeadChannel(row) {
  const words = row.description.split(' ');
  for (const n of [2, 1]) {
    if (words.length <= n) continue;
    const lead = words.slice(0, n).join(' '), rest = words.slice(n).join(' ');
    if (rest.includes(lead)) { row.channel = lead; row.description = rest; return; }
  }
}
