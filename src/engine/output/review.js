// The Review workbook for one statement: Transactions, Daily, Proof. Ported
// from the answer key's build_workbook. Dates are ISO TEXT on purpose.
import { Sheet, Cell, money, HEADER, BOLD, BAD, PLAIN, MONEY, MONEY_BOLD } from './xlsx.js';
import { parseDate } from '../dates.js';
import { buildDaily } from '../daily.js';
import { caveatFirst } from '../general.js';

const basename = name => String(name).split(/[\\/]/).pop();
const moneyOrBlank = v => (v !== null && v !== undefined ? money(v, MONEY) : new Cell('', MONEY));

export function buildWorkbook(rows, opening, closingComputed, facts, checks, profile, source) {
  // Show the period ends in the same ISO form as the rows, so it sorts.
  const iso = stamp => {
    if (!stamp) return '';
    try { return parseDate(stamp, facts)[0] || stamp; } catch { return stamp; }
  };

  const tx = new Sheet('Transactions', { widths: [12, 7, 26, 14, 14, 15, 22, 40, 34], freezeRows: 1 });
  tx.add(...['Date', 'Time', 'Description', 'Withdrawal', 'Deposit', 'Balance', 'Channel', 'Details', 'Check']
    .map(h => new Cell(h, HEADER)));
  tx.add(new Cell(iso(facts.period_from), BOLD), '', new Cell('Opening balance', BOLD), '', '',
    money(opening, MONEY_BOLD), '', '', '');
  for (const row of rows) {
    tx.add(row.date, row.time, row.description,
      moneyOrBlank(row.withdrawal), moneyOrBlank(row.deposit), moneyOrBlank(row.balance),
      row.channel, row.details,
      row.ok ? new Cell('OK', PLAIN) : new Cell(row.notes.join('; '), BAD));
  }
  tx.add(new Cell(iso(facts.period_to), BOLD), '', new Cell('Closing balance', BOLD), '', '',
    money(closingComputed, MONEY_BOLD), '', '', '');

  const days = buildDaily(rows, opening, iso(facts.period_from), iso(facts.period_to));
  const active = days.filter(d => d.count).length;
  const daily = new Sheet('Daily', { widths: [12, 14, 15, 15, 15, 17, 20], freezeRows: 1 });
  daily.add(...['Date', 'Transactions', 'Withdrawals', 'Deposits', 'Net change', 'Closing balance', 'Check']
    .map(h => new Cell(h, HEADER)));
  for (const day of days) {
    const check = !day.count ? new Cell('', PLAIN)                 // a quiet day has nothing to check
      : day.flagged ? new Cell(`${day.flagged} row(s) flagged`, BAD) : new Cell('OK', PLAIN);
    daily.add(day.date, new Cell(day.count, PLAIN),
      moneyOrBlank(day.withdrawn), moneyOrBlank(day.deposited),
      moneyOrBlank(day.deposited - day.withdrawn), moneyOrBlank(day.balance), check);
  }
  // The totals tie this sheet back to the Transactions sheet.
  const total = k => days.reduce((a, d) => a + d[k], 0);
  daily.add(new Cell(`${days.length} days, ${active} active`, BOLD),
    new Cell(total('count'), BOLD),
    money(total('withdrawn'), MONEY_BOLD), money(total('deposited'), MONEY_BOLD),
    money(total('deposited') - total('withdrawn'), MONEY_BOLD),
    money(closingComputed, MONEY_BOLD), '');

  const proof = new Sheet('Proof', { widths: [46, 10, 52] });
  caveatFirst(proof, profile);
  proof.add(new Cell('How this file was checked', BOLD));
  proof.add('');
  for (const [label, value] of [
    ['Source PDF', basename(source)],
    ['Bank', profile.bank],
    ['Account name', facts.account_name || '(not read)'],
    ['Account number', facts.account_no || '(not read)'],
    ['Branch', facts.branch || '(not read)'],
    ['Statement period', `${facts.period_from ?? 'None'} to ${facts.period_to ?? 'None'}`],
    ['Transactions read', rows.length],
  ]) proof.add(new Cell(label, BOLD), '', String(value));

  proof.add('');
  proof.add(new Cell('Check', HEADER), new Cell('Result', HEADER), new Cell('Detail', HEADER));
  for (const [label, passed, detail] of checks) {
    proof.add(label, passed ? new Cell('PASS', PLAIN) : new Cell('FAIL', BAD), new Cell(detail, passed ? PLAIN : BAD));
  }

  proof.add('');
  proof.add(new Cell('The rule every row is tested against', BOLD));
  proof.add("this row's balance = last row's balance + deposit - withdrawal");
  proof.add('Dates are written as text in ISO form (2026-06-09) on purpose, so that ' +
    'Excel cannot re-display them in the Buddhist calendar.');
  proof.add('The Express import files beside this one are the one exception: ' +
    'Express reads a real date, so they carry a real date forced to ' +
    'DD/MM/YYYY Gregorian.');
  return [tx, daily, proof];
}
