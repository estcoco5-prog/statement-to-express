// The Review workbook for one statement: Transactions, Daily, Proof. Ported
// from the answer key's build_workbook. Dates are real dates shown DD/MM/YYYY.
import { Sheet, Cell, money, HEADER, BOLD, BAD, PLAIN, MONEY, MONEY_BOLD, DATE } from './xlsx.js';
import { excelSerial } from './express.js';
import { parseDate } from '../dates.js';
import { buildDaily } from '../daily.js';
import { caveatFirst, PHOTO_CAVEAT } from '../general.js';

const basename = name => String(name).split(/[\\/]/).pop();
// A real Excel date shown DD/MM/YYYY, like the Express template; a date that
// could not be read stays as the text the bank printed.
const dateCell = stamp => {
  const serial = excelSerial(stamp);
  return serial === null ? stamp : new Cell(serial, DATE);
};
const moneyOrBlank = v => (v !== null && v !== undefined ? money(v, MONEY) : new Cell('', MONEY));

export function buildWorkbook(rows, opening, closingComputed, facts, checks, profile, source, fromPhoto = false) {
  // Show the period ends in the same ISO form as the rows, so it sorts.
  const iso = stamp => {
    if (!stamp) return '';
    try { return parseDate(stamp, facts)[0] || stamp; } catch { return stamp; }
  };

  // From photos, a last column names the photo page of each row: where to check it.
  const pageCol = fromPhoto ? [new Cell('Photo page', HEADER)] : [];
  const blank = fromPhoto ? [''] : [];
  const tx = new Sheet('Transactions', { widths: [12, 7, 26, 14, 14, 15, 22, 40, 34, ...(fromPhoto ? [11] : [])], freezeRows: 1 });
  tx.add(...['Date', 'Time', 'Description', 'Withdrawal', 'Deposit', 'Balance', 'Channel', 'Details', 'Check']
    .map(h => new Cell(h, HEADER)), ...pageCol);
  tx.add(dateCell(iso(facts.period_from)), '', new Cell('Opening balance', BOLD), '', '',
    money(opening, MONEY_BOLD), '', '', '', ...blank);
  for (const row of rows) {
    tx.add(dateCell(row.date), row.time, row.description,
      moneyOrBlank(row.withdrawal), moneyOrBlank(row.deposit), moneyOrBlank(row.balance),
      row.channel, row.details,
      row.ok ? new Cell('OK', PLAIN) : new Cell(row.notes.join('; '), BAD),
      ...(fromPhoto ? [new Cell(row.page ?? '', PLAIN)] : []));
  }
  tx.add(dateCell(iso(facts.period_to)), '', new Cell('Closing balance', BOLD), '', '',
    money(closingComputed, MONEY_BOLD), '', '', '', ...blank);

  const days = buildDaily(rows, opening, iso(facts.period_from), iso(facts.period_to));
  const active = days.filter(d => d.count).length;
  const daily = new Sheet('Daily', { widths: [12, 14, 15, 15, 15, 17, 20], freezeRows: 1 });
  daily.add(...['Date', 'Transactions', 'Withdrawals', 'Deposits', 'Net change', 'Closing balance', 'Check']
    .map(h => new Cell(h, HEADER)));
  for (const day of days) {
    const check = !day.count ? new Cell('', PLAIN)                 // a quiet day has nothing to check
      : day.flagged ? new Cell(`${day.flagged} row(s) flagged`, BAD) : new Cell('OK', PLAIN);
    daily.add(dateCell(day.date), new Cell(day.count, PLAIN),
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
  if (fromPhoto) proof.add(new Cell(PHOTO_CAVEAT, BAD));
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
  proof.add('Dates are real Excel dates shown as DD/MM/YYYY (Western years), the ' +
    'same as the Express template. The format is fixed in the file, so a ' +
    'Thai Windows setting cannot turn them into Buddhist years.');
  return [tx, daily, proof];
}
