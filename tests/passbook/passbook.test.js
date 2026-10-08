// The passbook card: the dot-pattern reader on made-up pages, and the rules
// that decide which lines reach Express. Every figure here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPassbook, moneyShape, cents, resample } from '../../src/passbook/reader.js';
import { KTB_PASSBOOK } from '../../src/passbook/printers/ktb.js';
import { passbookStatement, passbookDate, LAST_LINE } from '../../src/passbook/statement.js';
import { statusOf, partialRows, rowsToCheck } from '../../src/engine/statement.js';
import { groupBatch } from '../../src/engine/batch.js';
import { expressFiles } from '../../src/engine/output/express.js';
import { madeUpPage } from './madeup.js';

const BOOK = [
  { date: '03/01/68', balance: '*1,000.00' },
  { date: '03/01/68', amount: '+250.00', balance: '*1,250.00' },
  { date: '04/01/68', amount: '-1,200.50', balance: '*49.50' },
  { date: '05/02/68', amount: '+12,345.67', balance: '*12,395.17' },
  { date: '06/02/68', amount: '+80.00', balance: '*12,475.17' },
  { date: '06/02/68', amount: '-9.99', balance: '*12,465.18' },
];

test('the reader reads a made-up page printed from its own patterns', async () => {
  const lines = await readPassbook([madeUpPage(BOOK)], KTB_PASSBOOK);
  assert.equal(lines.length, BOOK.length);
  lines.forEach((l, i) => {
    assert.equal(l.date, BOOK[i].date, `line ${i + 1} date`);
    assert.equal(l.amount, BOOK[i].amount ?? null, `line ${i + 1} amount`);
    assert.equal(l.balance, BOOK[i].balance, `line ${i + 1} balance`);
  });
});

test('a scan at another size is brought to the printer\'s line height first', async () => {
  const lines = await readPassbook([resample(madeUpPage(BOOK), 1.5)], KTB_PASSBOOK);
  assert.deepEqual(lines.map(l => l.balance), BOOK.map(l => l.balance));
});

test('money can only have the lengths a printed figure has', () => {
  assert.equal(moneyShape(7).join('|'), '+-*|0123456789|0123456789|0123456789|.|0123456789|0123456789');
  assert.ok(moneyShape(9));            // +1,000.00
  assert.equal(moneyShape(8), null);    // +1000.00 cannot be printed
  assert.equal(moneyShape(12), null);
  assert.equal(cents('*12,395.17'), 1239517);
});

test('a passbook date is a two-digit Buddhist year', () => {
  assert.equal(passbookDate('25/05/68'), '2025-05-25');
  assert.equal(passbookDate('07/02/69'), '2026-02-07');
  assert.equal(passbookDate('31/02/68'), null);
  assert.equal(passbookDate('2/05/68'), null);
});

// Lines as the reader hands them over, without reading pictures.
const line = (page, n, date, amount, balance, extra = {}) =>
  ({ page, line: n, date, amount, balance, dateMargin: 0.2, unsure: 0, garbled: false, ...extra });
const good = () => [
  line(1, 1, '03/01/68', null, '*1,000.00'),
  line(1, 2, '03/01/68', '+250.00', '*1,250.00'),
  line(1, 3, '04/01/68', '-1,200.50', '*49.50'),
  line(2, 1, '05/02/68', '+12,345.67', '*12,395.17'),
  line(2, 2, '06/02/68', '+80.00', '*12,475.17'),
];

test('a clean passbook: every line but the last goes to Express', () => {
  const s = passbookStatement('Passbook.pdf', good(), KTB_PASSBOOK, { account: '1112223334' });
  assert.equal(s.opening, 100000);                         // the brought-forward line
  assert.equal(s.rows.length, 4);
  assert.equal(statusOf(s), 'red');                        // the last line is never confirmed...
  // line 1 is checked against a brought-forward balance that is only read, the
  // last line has nothing after it: both listed; the lines between go
  assert.deepEqual(partialRows(s).map(r => r.balance), [4950, 1239517]);
  assert.deepEqual(rowsToCheck(s).map(r => `${r.page}:${r.line}`), ['1:2', '2:2']);
  assert.ok(s.checks.some(([label, ok]) => label === LAST_LINE && !ok));
  assert.equal(s.rows[1].withdrawal, 120050);
  assert.equal(s.facts.period_from, '03/01/2025');
  const [group] = groupBatch([s]);
  assert.ok(group.isPartial(s));
  const [out] = expressFiles([group]);
  assert.equal(out.n, 2);
  assert.ok(out.sheets.some(sh => sh.name === 'Rows to check'));
});

test('a misread copied into one line\'s amount AND balance never reaches Express', () => {
  const lines = good();
  lines[1] = line(1, 2, '03/01/68', '+850.00', '*1,850.00');   // 2 read as 8 in both
  const s = passbookStatement('Passbook.pdf', lines, KTB_PASSBOOK);
  const sent = (partialRows(s) ?? []).map(r => `${r.page}:${r.line}`);
  assert.ok(!sent.includes('1:2'), 'the misread line is held back by the line after it');
  assert.ok(!sent.includes('1:3'), 'the line after it does not chain');
});

test('a missing page breaks the chain where the pages meet', () => {
  const lines = good().filter(l => l.page === 1);
  lines.push(line(3, 1, '09/03/68', '+10.00', '*500.00'), line(3, 2, '09/03/68', '+10.00', '*510.00'));
  const s = passbookStatement('Passbook.pdf', lines, KTB_PASSBOOK);
  const link = s.checks.find(([label]) => label.startsWith('Each page carries on'));
  assert.equal(link[1], false);
  assert.match(link[2], /page 1 -> 3/);
  assert.ok(rowsToCheck(s).some(r => r.page === 3 && r.line === 1));
  assert.ok(rowsToCheck(s).some(r => r.page === 1 && r.line === 3), 'the line before the gap is not confirmed either');
});

test('a doubtful date, a sign that disagrees, an unread amount: each line listed, the rest still go', () => {
  const lines = good();
  lines[2] = line(1, 3, '01/01/68', '-1,200.50', '*49.50');                 // goes backwards
  lines[3] = line(2, 1, '05/02/68', '-12,345.67', '*12,395.17');            // printed minus, balance went up
  lines.push(line(2, 3, '06/02/68', '+5.00', '*12,480.17', { dateMargin: 0.01 }),  // unsure date
    line(2, 4, '07/02/68', null, '*12,490.17'),                              // amount not read
    line(2, 5, '07/02/68', '+1.00', '*12,491.17'));
  const s = passbookStatement('Passbook.pdf', lines, KTB_PASSBOOK);
  const why = Object.fromEntries(rowsToCheck(s).map(r => [`${r.page}:${r.line}`, r.notes.join('; ')]));
  assert.match(why['1:3'], /earlier than the line above/);
  assert.match(why['2:1'], /printed as a withdrawal but the balance says deposit/);
  assert.match(why['2:3'], /unsure of the date/);
  assert.match(why['2:4'], /amount on this line could not be read/);
  assert.match(why['1:2'], /may be read too late/);          // the line above a backwards date is listed too
  assert.deepEqual(partialRows(s).map(r => `${r.page}:${r.line}`), ['2:2']);
});

test('no brought-forward line: the first line is worked back and listed to check', () => {
  const s = passbookStatement('Passbook.pdf', good().slice(1), KTB_PASSBOOK);
  assert.equal(s.opening, 100000);
  assert.ok(s.facts.opening_derived);
  assert.match(rowsToCheck(s)[0].notes.join(' '), /nothing before it/);
});

// G8 passbook review probes (truth in each comment). None of these may put a
// wrong figure in Express.
test('probe S1: an unreadable brought-forward line does not let line 2 prove itself', () => {
  // truth: BF 1,000.00; +250.00 -> 1,250.00; -200.00 -> 1,050.00; +10.00 -> 1,060.00
  const s = passbookStatement('x', [line(1, 1, '03/01/68', null, null), line(1, 2, '03/01/68', '+850.00', '*1,250.00'),
    line(1, 3, '04/01/68', '-200.00', '*1,050.00'), line(1, 4, '05/01/68', '+10.00', '*1,060.00')], KTB_PASSBOOK);
  assert.ok(!(partialRows(s) ?? []).some(r => r.line === 2), 'the misread 850.00 is held back');
});

test('probe S2: a misread in the balance above and in this amount does not cancel out', () => {
  // truth: BF 12,000.00; +345.00 -> 12,345.00; -2,300.00 -> 10,045.00; +5.00; +1.00
  const s = passbookStatement('x', [line(1, 1, '03/01/68', null, '*12,000.00'), line(1, 2, '03/01/68', '+345.00', '*12,845.00'),
    line(1, 3, '04/01/68', '-2,800.00', '*10,045.00'), line(1, 4, '05/01/68', '+5.00', '*10,050.00'),
    line(1, 5, '05/01/68', '+1.00', '*10,051.00')], KTB_PASSBOOK);
  const sent = (partialRows(s) ?? []).map(r => r.line);
  assert.ok(!sent.includes(2) && !sent.includes(3), 'neither the misread balance nor the 2,800.00 goes');
  assert.deepEqual(sent, [4]);
});

test('probe S3: a date read too late is listed, not only the right lines after it', () => {
  // truth: 13/01 read as 18/01 on line 2
  const s = passbookStatement('x', [line(1, 1, '03/01/68', null, '*1,000.00'), line(1, 2, '18/01/68', '+250.00', '*1,250.00'),
    line(1, 3, '14/01/68', '-200.00', '*1,050.00'), line(1, 4, '15/01/68', '+10.00', '*1,060.00'),
    line(1, 5, '15/01/68', '+10.00', '*1,070.00')], KTB_PASSBOOK);
  assert.ok(rowsToCheck(s).some(r => r.line === 2), 'the line read 18/01 is listed');
  assert.ok(!(partialRows(s) ?? []).some(r => r.date === '2025-01-18'));
});

test('probe R1: a misread brought-forward balance and a matching misread in line 1 do not cancel out', () => {
  // truth: BF 12,345.00; -2,300.00 -> 10,045.00 - a 3 read as 8 in both
  const s = passbookStatement('x', [line(1, 1, '03/01/68', null, '*12,845.00'), line(1, 2, '03/01/68', '-2,800.00', '*10,045.00'),
    line(1, 3, '04/01/68', '+5.00', '*10,050.00'), line(1, 4, '05/01/68', '+1.00', '*10,051.00')], KTB_PASSBOOK);
  assert.ok(!(partialRows(s) ?? []).some(r => r.line === 2), 'the 2,800.00 is held back');
});
