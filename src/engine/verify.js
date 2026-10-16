// Step 4 - the proof.
import { fmtMoney } from './money.js';
import { periodBounds } from './dates.js';
import { Row } from './extract.js';
import { inWithdrawalColumn } from './profiles.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Python prints a Decimal sum that never had a term added as "0", not "0.00".
const sumText = (values) => (values.length ? fmtMoney(values.reduce((a, b) => a + b, 0)) : '0');

// Decide withdrawal vs deposit, and prove every row against the balance.
// The column a number printed in CANNOT be trusted to say what it is (KBank's
// two amount columns overlap). The running balance can: if the balance went
// down, money left. The column is kept as a second opinion only.
export function classifyAndVerify(opening, rows, profile) {
  let running = opening;
  let pending = [];      // rows the bank printed no balance for, awaiting one
  for (const row of rows) {
    if (row.amount === null) continue;
    if (row.balance === null) { pending.push(row); continue; }
    if (pending.length) {
      running = verifyGroup(running, [...pending, row], profile);
      pending = [];
      continue;
    }
    const delta = row.balance - running;
    // A row the bank took tax from moves the balance by the amount less the
    // tax (interest 39.68, tax 0.40: the balance rises 39.28).
    const moved = row.tax ? delta + row.tax : delta;

    if (moved !== 0 && Math.abs(Math.abs(moved) - row.amount) <= 0) {
      if (moved > 0) row.deposit = row.amount; else row.withdrawal = row.amount;
      row.verified = true;
    } else if (delta === 0) {
      // Nothing to read the direction from; guessing from the column is unsafe.
      row.notes.push(`the balance did not change, so whether ${fmtMoney(row.amount)} went in or ` +
        'out cannot be determined - check this row by hand');
    } else {
      row.notes.push(`balance chain broken: ${fmtMoney(running)} -> ${fmtMoney(row.balance)} is a ` +
        `change of ${fmtMoney(delta)}, but the amount printed is ${fmtMoney(row.amount)}` +
        (row.tax ? ` (tax ${fmtMoney(row.tax)})` : ''));
    }

    if (row.amountX1 !== null && profile.amountSplitX !== null && (row.withdrawal || row.deposit)) {
      const looksLike = inWithdrawalColumn(row.amountX1, profile) ? 'withdrawal' : 'deposit';
      const actual = row.withdrawal ? 'withdrawal' : 'deposit';
      if (looksLike !== actual) {
        row.notes.push(`the balance says this is a ${actual}, but it is printed in the ` +
          `${looksLike} column - the balance was believed`);
      }
    }
    running = row.balance;
  }
  for (const row of pending) {
    row.notes.push('no balance was printed after this row, so it could not be checked against one');
  }
  splitTax(rows);
  return running;
}

// Lines that move no money: an amount of 0.00 with the balance unchanged from
// the line before (Co 2026-10-16: "nothing to post"). They are taken out
// before the proof - each would otherwise be a line whose direction "cannot be
// determined", holding its neighbours with it. A 0.00 whose balance DID move
// is a misread, and stays in to be caught.
export function dropZeroLines(opening, rows, label = r => `${r.date} ${r.description}`.trim()) {
  const kept = [], dropped = [];
  let before = opening;
  for (const row of rows) {
    if (row.amount === 0 && !row.tax && row.balance !== null && before !== null && row.balance === before) {
      dropped.push(label(row));
      continue;
    }
    kept.push(row);
    if (row.balance !== null) before = row.balance;
  }
  return { rows: kept, dropped };
}

export const TAX_LABEL = 'ภาษีหัก ณ ที่จ่าย';

// Give the bank's withholding tax its own withdrawal row (Co 2026-10-02): the
// interest is booked gross, the tax as money out. The interest row's balance
// becomes the balance before the tax, the tax row's the printed one. A row the
// balance did not confirm keeps its tax - it is flagged already.
function splitTax(rows) {
  const out = [];
  for (const row of rows) {
    out.push(row);
    if (row.tax && row.verified) {
      const tax = new Row();
      tax.date = row.date; tax.time = row.time;
      tax.description = tax.details = TAX_LABEL;
      tax.amount = tax.withdrawal = row.tax;
      tax.balance = row.balance;
      tax.verified = tax.isTax = true;
      row.balance = row.balance + row.tax;
      out.push(tax);
    }
  }
  rows.splice(0, rows.length, ...out);
}

// Rows that share one printed balance (on the group's last row): each row's
// direction comes from its column, and the group as a whole must land exactly
// on the printed balance. If it does not, every row in it is flagged.
function verifyGroup(running, group, profile) {
  const last = group[group.length - 1];
  const terms = [];
  let complete = true;
  for (const row of group) {
    if (row.amountX1 === null || profile.amountSplitX === null) { complete = false; break; }
    terms.push(inWithdrawalColumn(row.amountX1, profile) ? -row.amount : row.amount);
  }
  const net = terms.reduce((a, b) => a + b, 0);
  if (complete && net === last.balance - running) {
    for (const row of group) {
      if (inWithdrawalColumn(row.amountX1, profile)) row.withdrawal = row.amount; else row.deposit = row.amount;
      row.verified = true;
    }
    return last.balance;
  }
  for (const row of group) {
    row.notes.push(`these ${group.length} rows share one printed balance, and they do not add up ` +
      `to it: ${fmtMoney(running)} -> ${fmtMoney(last.balance)} is a change of ` +
      `${fmtMoney(last.balance - running)}, the rows net ${sumText(terms)}`);
  }
  return last.balance;
}

// The independent checks, each answerable yes or no: [label, passed, detail].
export function buildChecks(opening, rows, closingComputed, facts) {
  // The bank's own withdrawal total leaves its tax out (seen on KTB
  // Corporate), so tax rows are compared on their own line below.
  const withdrawals = rows.filter(r => r.withdrawal !== null && !r.isTax).map(r => r.withdrawal);
  const taxes = rows.filter(r => r.isTax).map(r => r.withdrawal);
  const deposits = rows.filter(r => r.deposit !== null).map(r => r.deposit);
  const checks = [];

  const unverified = rows.filter(r => !r.verified);
  checks.push(['Every row agrees with the running balance', !unverified.length,
    `${rows.length - unverified.length} of ${rows.length} rows verified` +
    (unverified.length ? `; ${unverified.length} could not be` : '')]);

  // The balance proves the money only: a date misread as an earlier day passes
  // every arithmetic check. Rows are listed in date order, so a date that goes
  // backwards is a misread or a row out of place.
  const dated = rows.filter(r => ISO_RE.test(r.date ?? ''));
  const backwards = [];
  for (let i = 1; i < dated.length; i++) if (dated[i].date < dated[i - 1].date) backwards.push([dated[i - 1], dated[i]]);
  checks.push(['Dates never go backwards', !backwards.length,
    backwards.length ? backwards.map(([a, b]) => `${b.date} comes after ${a.date}`).join('; ') : 'in order']);

  if (facts.closing_stated !== null) {
    checks.push(['Final balance matches the closing balance the bank printed',
      closingComputed === facts.closing_stated,
      `computed ${fmtMoney(closingComputed)} vs printed ${fmtMoney(facts.closing_stated)}`]);
  }

  for (const [label, printedTotal, printedCount, values] of [
    ['withdrawals', facts.withdraw_total, facts.withdraw_count, withdrawals],
    ['deposits', facts.deposit_total, facts.deposit_count, deposits],
  ]) {
    if (printedTotal !== null) {
      const got = values.reduce((a, b) => a + b, 0);
      checks.push([`Total ${label} matches the bank's own total`, got === printedTotal,
        `computed ${sumText(values)} vs printed ${fmtMoney(printedTotal)}`]);
    }
    if (printedCount !== null) {
      // A bank may count its 0.00 lines (left out above) among its items.
      const zeros = facts.zero_lines?.length ?? 0;
      const withZeros = zeros > 0 && values.length !== printedCount && values.length + zeros === printedCount;
      checks.push([`Number of ${label} matches the bank's own count`, values.length === printedCount || withZeros,
        withZeros ? `found ${values.length} + ${zeros} line(s) of 0.00 vs printed ${printedCount}`
          : `found ${values.length} vs printed ${printedCount}`]);
    }
  }

  if (taxes.length) {
    checks.push(['Tax the bank withheld, written as its own withdrawal rows', true,
      `${taxes.length} row(s), total ${sumText(taxes)}`]);
  }

  if (facts.opening_derived) {
    // Not a check in itself - the totals confirm it - but the reader must know
    // the bank never printed this number.
    checks.push(['Opening balance (not printed by the bank) worked back from row 1', true,
      facts.withdraw_total !== null || facts.deposit_total !== null
        ? `${fmtMoney(opening)}; confirmed only through the totals checks above`
        : `${fmtMoney(opening)}; the bank printed no totals to confirm it - the balance ` +
          'chain proves every line after the first']);
  }

  const bounds = periodBounds(facts);
  if (bounds) {
    const outside = rows.filter(r => ISO_RE.test(r.date ?? '') && !(bounds[0] <= r.date && r.date <= bounds[1]));
    if (outside.length) {
      // Allowed (the transaction date is what goes in), but listed, because
      // such a row lands in a different month in Express.
      checks.push(['Rows dated outside the statement period (allowed, listed)', true,
        outside.map(r => {
          const v = r.withdrawal || r.deposit || r.amount;
          return `${r.date} ${v === null ? 'None' : fmtMoney(v)}`;
        }).join('; ')]);
    }
  }

  // A month or more of the stated period with no lines at all, at its start or
  // end: allowed (Co 2026-10-13: work with the file the client sent), but said,
  // because a bank export cut short looks exactly like this.
  if (bounds && dated.length) {
    const day = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
    const shift = (iso, n) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);
    const first = dated.map(r => r.date).reduce((a, b) => (b < a ? b : a));
    const last = dated.map(r => r.date).reduce((a, b) => (b > a ? b : a));
    const empty = [];
    if (day(first) - day(bounds[0]) >= 28) empty.push(`${bounds[0]} to ${shift(first, -1)}`);
    if (day(bounds[1]) - day(last) >= 28) empty.push(`${shift(last, 1)} to ${bounds[1]}`);
    if (empty.length) {
      checks.push(['A month or more of the statement period has no lines (allowed, listed)', true,
        empty.map(e => `no lines ${e}`).join('; ') + ' - if the account was used then, this file may be cut short']);
    }
  }

  if (facts.period_from_rows) {
    // The form prints no period: its first and last lines stand in for it.
    checks.push(['Statement period not printed - taken from the first and last lines (allowed, listed)', true,
      `${facts.period_from} to ${facts.period_to}`]);
  }
  if (facts.zero_lines?.length) {
    // Co 2026-10-16: a 0.00 line moves no money (a bounced-cheque fee of 0.00):
    // nothing to post, so it is left out of Express - and listed here.
    checks.push(['Lines of 0.00 left out - nothing to post (allowed, listed)', true, facts.zero_lines.join('; ')]);
  }

  const other = rows.filter(r => r.verified && r.notes.length);
  checks.push(['No other anomalies on any row', !other.length,
    other.length ? `${other.length} row(s) carry a warning` : 'clean']);
  return checks;
}
