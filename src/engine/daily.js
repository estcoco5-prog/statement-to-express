// One entry per calendar day of the statement period. Quiet days are included
// so the series is continuous; the span comes from the period the bank printed,
// so no day outside the statement is invented. Money in satang.
import { addDays } from './dates.js';

function daySpan(first, last) {
  const ok = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
  if (!ok(first) || !ok(last) || last < first) return [];
  const out = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

const emptyDay = date => ({ date, count: 0, flagged: 0, withdrawn: 0, deposited: 0, balance: null });

export function buildDaily(rows, opening, periodFrom = null, periodTo = null) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, emptyDay(row.date));
    const day = byDate.get(row.date);
    day.count += 1;
    day.withdrawn += row.withdrawal ?? 0;
    day.deposited += row.deposit ?? 0;
    if (row.balance !== null) day.balance = row.balance;     // the day's last known balance
    if (!row.ok) day.flagged += 1;
  }

  const span = daySpan(periodFrom, periodTo);
  if (!span.length) return [...byDate.values()];

  const days = [];
  let carried = opening;
  for (const date of span) {
    const day = byDate.get(date) ?? emptyDay(date);
    byDate.delete(date);
    if (day.balance === null) day.balance = carried;          // nothing moved, so it carries
    carried = day.balance;
    days.push(day);
  }
  // A dated row outside the bank's own period would otherwise vanish. Show it.
  days.push(...byDate.values());
  return days;
}
