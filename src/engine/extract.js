// Step 3 - read the transaction rows.
import { StatementError } from './errors.js';
import { parseAmount, fmtMoney } from './money.js';
import { Word } from './words.js';
import { DATE_RE, TIME_RE, ROW_TOLERANCE, groupIntoRows, rowText, rowY } from './rows.js';
import { D_MON_RE, parseDate, parseDMon } from './dates.js';
import { cellsByColumn } from './header.js';

export { cellsByColumn };

export class Row {
  constructor() {
    this.date = ''; this.time = '';
    this.description = ''; this.channel = ''; this.details = '';
    this.amount = null;       // as printed, direction not yet known (satang)
    this.amountX1 = null;     // right edge, for the position cross-check
    this.balance = null;
    this.withdrawal = null; this.deposit = null;
    this.notes = [];
    // Set only when the running balance confirmed this row - a real flag, so
    // a new kind of warning can never quietly weaken the balance check.
    this.verified = false;
  }
  get ok() { return this.notes.length === 0; }
}

// Catch the row grouping having swallowed two real lines at once.
export function checkRowSanity(buckets) {
  const dates = (buckets.date ?? []).filter(w => DATE_RE.test(w.text));
  if (dates.length > 1) {
    throw new StatementError(
      `two dates landed on one line ([${dates.map(w => `'${w.text}'`).join(', ')}]) - the row ` +
      `tolerance of ${ROW_TOLERANCE.toFixed(1)}pt is too generous for this statement`);
  }
}

const has = (text, marks) => (marks ?? []).some(m => text.includes(m));

export function extractRows(pages, profile, facts) {
  let opening = null;
  const rows = [];

  for (const words of pages) {
    // A wrapped description prints directly beneath its own transaction, so it
    // never crosses a page break: the lines at the top of a new page are that
    // page's header, not a continuation of the last row before it.
    let wrappable = null, wrapY = null;
    for (const line of groupIntoRows(words)) {
      const text = rowText(line);
      const buckets = cellsByColumn(line, profile);

      let dateWords;
      if (profile.dateStyle === 'd_mon') {
        // '01 Sep' is two words; treat the date column as one token.
        const joined = (buckets.date ?? []).map(w => w.text).join(' ');
        dateWords = D_MON_RE.test(joined) ? [new Word(0, 0, 0, 0, joined)] : [];
      } else {
        dateWords = (buckets.date ?? []).filter(w => DATE_RE.test(w.text));
      }
      const balances = (buckets.balance ?? []).map(w => [w, parseAmount(w.text)]).filter(([, a]) => a !== null);
      let money = (buckets.amount ?? []).map(w => [w, parseAmount(w.text)]).filter(([, a]) => a !== null);
      // A transaction has a date and a balance - or, for a bank that prints the
      // balance only on some rows, a date and an amount.
      const isRow = dateWords.length > 0 &&
        (balances.length > 0 || (!profile.balanceEveryRow && money.length > 0));

      // Page furniture ends the page - but a margin stamp can sit level with a
      // real last row. A line carrying a date and a balance is data.
      if (has(text, profile.marks.footer) && !isRow) break;

      checkRowSanity(buckets);

      // The opening row: a date and a balance, no amount. It repeats at the top
      // of every page as a carry-forward; only the first one counts.
      if (has(text, profile.marks.opening) && balances.length) {
        if (opening === null) opening = balances[balances.length - 1][1];
        continue;
      }

      if (!isRow) {
        // No date and no balance: a description wrapped onto a second line
        // belongs to the transaction above it, on this page.
        if (wrappable !== null && !dateWords.length && !balances.length) {
          if (profile.wrapReach !== null && (rowY(line) - wrapY > profile.wrapReach
              || !['description', 'channel', 'details'].some(f =>
                (buckets[f] ?? []).some(w => /[\p{L}\p{N}]/u.test(w.text))))) {
            wrappable = null;               // a gap or a ruled line: the table ended
          } else {
            appendWrapped(wrappable, buckets);
            wrapY = rowY(line);
          }
        }
        continue;
      }

      const row = new Row();
      const [date, warning] = profile.dateStyle === 'd_mon'
        ? parseDMon(dateWords[0].text, facts) : parseDate(dateWords[0].text, facts);
      row.date = date;
      if (warning) row.notes.push(warning);
      if (row.date === null) {
        row.date = dateWords[0].text;
        row.notes.push('date could not be read');
      }

      const times = (buckets.time ?? []).map(w => w.text).filter(t => TIME_RE.test(t));
      row.time = times.length ? times[0] : '';
      row.description = (buckets.description ?? []).map(w => w.text).join(' ');
      row.channel = (buckets.channel ?? []).map(w => w.text).join(' ');
      row.details = (buckets.details ?? []).map(w => w.text).join(' ');
      row.balance = balances.length ? balances[balances.length - 1][1] : null;

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

      rows.push(row);
      wrappable = row; wrapY = rowY(line);
    }
  }

  for (const row of rows) flagFurniture(row, profile);

  if (opening === null && !profile.openingPrinted && rows.length) opening = deriveOpening(rows[0], profile, facts);

  if (opening === null) {
    throw new StatementError(
      `the opening balance row (${profile.marks.opening.join('/')}) was not found - without it ` +
      'the balance chain has no starting point');
  }
  return { opening, rows };
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
  const wentOut = first.amountX1 < profile.amountSplitX;
  facts.opening_derived = true;
  return wentOut ? first.balance + first.amount : first.balance - first.amount;
}

export const isThai = ch => ch >= '฀' && ch <= '๿';

// Glue a wrapped continuation line onto the transaction it belongs to.
export function appendWrapped(row, buckets) {
  if (!row.time) {
    // KTB prints the time on the line under the date.
    for (const w of [...(buckets.date ?? []), ...(buckets.time ?? [])]) {
      if (TIME_RE.test(w.text)) { row.time = w.text; break; }
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
