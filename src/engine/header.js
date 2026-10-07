// The facts the bank printed at the top (and foot) of the statement - the
// independent answer key every check is measured against.
import { parseAmount } from './money.js';
import { columnOf } from './profiles.js';
import { FIELD_GAP, rowText } from './rows.js';
import { periodDates } from './dates.js';

// Sort one line's words into the bank's columns.
export function cellsByColumn(row, profile) {
  const buckets = {};
  for (const word of row) {
    const name = columnOf(profile, word.x0, word.x1);
    if (name) (buckets[name] ??= []).push(word);
  }
  return buckets;
}

// A bank account number: 10-12 digits, optionally split by dashes.
export function looksLikeAccount(text) {
  if (!text || !/^\d[\d-]*\d$/.test(text)) return false;
  const digits = [...text].filter(c => c >= '0' && c <= '9').length;
  return digits >= 10 && digits <= 12;
}

// 'รวมถอนเงิน 1 รายการ' -> 1. Some banks print the count as a bare number
// beside the total instead; then the one whole-number word is it.
export function countIn(text, row = []) {
  const match = /(\d+)\s*รายการ/.exec(text);
  if (match) return Number(match[1]);
  const whole = row.filter(w => /^\d+$/.test(w.text)).map(w => Number(w.text));
  return whole.length === 1 ? whole[0] : null;
}

// The words following a label, stopping at the edge of its block.
function afterMark(row, mark) {
  for (let i = 0; i < row.length; i++) {
    if (!row[i].text.includes(mark)) continue;
    const collected = [];
    let previous = row[i];
    for (const next of row.slice(i + 1)) {
      if (next.x0 - previous.x1 > FIELD_GAP) break;    // the next block along
      collected.push(next.text);
      previous = next;
    }
    return collected;
  }
  return [];
}

// Spaces are ignored: the photo reader can leave a Thai label in pieces
// ("รายก ารระหว่างวันที่").
const squash = s => s.replace(/\s+/g, '');
const has = (text, marks) => (marks ?? []).some(m => squash(text).includes(squash(m)));

export function parseHeader(rows, profile, { photo = false } = {}) {
  const marks = profile.marks;
  const facts = {
    ...(photo ? { from_photo: true } : {}),       // bank PDFs keep exactly the reference's facts
    account_no: null, account_name: null, branch: null,
    period_from: null, period_to: null, closing_stated: null,
    withdraw_total: null, withdraw_count: null,
    deposit_total: null, deposit_count: null,
  };

  for (const row of rows) {
    const text = rowText(row);
    const amounts = row.map(w => parseAmount(w.text)).filter(a => a !== null);

    if (facts.period_from === null && has(text, marks.period)) {
      const dates = periodDates(text);
      if (dates.length >= 2) [facts.period_from, facts.period_to] = dates;
    }
    if (has(text, marks.totals_line)) {
      // One line holding both totals and the closing balance, told apart by
      // which column each figure sits in - the same columns as the rows.
      const buckets = cellsByColumn(row, profile);
      const money = (buckets.amount ?? []).map(w => [w, parseAmount(w.text)]).filter(([, a]) => a !== null);
      if (money.length === 2) {
        for (const [w, a] of money) facts[w.x1 < profile.amountSplitX ? 'withdraw_total' : 'deposit_total'] = a;
        const closing = (buckets.balance ?? []).map(w => parseAmount(w.text)).filter(a => a !== null);
        if (closing.length) facts.closing_stated = closing[closing.length - 1];
      }
    }
    const last = amounts[amounts.length - 1];
    if (has(text, marks.closing) && amounts.length) facts.closing_stated = last;
    if (has(text, marks.total_withdraw) && amounts.length) {
      facts.withdraw_total = last;
      facts.withdraw_count = countIn(text, row);
    }
    if (has(text, marks.total_deposit) && amounts.length) {
      facts.deposit_total = last;
      facts.deposit_count = countIn(text, row);
    }
    if (has(text, marks.total_items)) {
      // Some banks print both counts on one line: withdrawals, deposits.
      const counts = row.filter(w => /^\d+$/.test(w.text)).map(w => Number(w.text));
      if (counts.length === 2) [facts.withdraw_count, facts.deposit_count] = counts;
    }
    for (const key of ['account_no', 'account_name', 'branch']) {
      if (facts[key] !== null) continue;
      for (const mark of marks[key]) {
        if (text.includes(mark)) {
          const rest = afterMark(row, mark);
          if (rest.length) facts[key] = rest.join(' ');
          break;
        }
      }
    }
  }

  // The labelled value can stop short ('No.') or miss when the number sits
  // further from its label than FIELD_GAP. An account number has a shape, so
  // look for it - but only on a row that carries the account label, never in
  // the transactions, which are full of other people's account numbers.
  if (!looksLikeAccount(facts.account_no)) {
    facts.account_no = null;
    for (const row of rows) {
      if (has(rowText(row), marks.account_no)) {
        const shaped = row.map(w => w.text).filter(looksLikeAccount);
        if (shaped.length) { facts.account_no = shaped[0]; break; }
      }
    }
  }
  // A PDF made from photos: the reader can skip a small grey period label
  // (KBank) yet read the range beside it. Exactly one "date - date" range on
  // the whole statement stands in for it; two or more say nothing.
  if (photo && facts.period_from === null) {
    const ranges = rows.map(rowText).filter(t => RANGE_RE.test(t));
    if (ranges.length === 1) {
      const dates = periodDates(ranges[0]);
      if (dates.length === 2) [facts.period_from, facts.period_to] = dates;
    }
  }
  return facts;
}
const RANGE_RE = /\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}/;
