// Picture -> Excel: the table reader on made-up reader output, and the Excel
// file it gives. Every figure and word here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pictureTable } from '../../src/picture/table.js';
import { pictureWorkbook } from '../../src/picture/excel.js';
import { readXlsx } from '../../src/table/read.js';
import { tableStatement } from '../../src/table/statement.js';
import { statusOf, partialRows, rowsToCheck } from '../../src/engine/statement.js';
import { pictureLights, SET_AT_MOST } from '../../src/picture/lights.js';
import { passbookTables } from '../../src/picture/passbook.js';
import { passbookStatement } from '../../src/passbook/statement.js';
import { KTB_PASSBOOK } from '../../src/passbook/printers/ktb.js';

// Words the way the photo reader hands them over: text and a box, in pixels.
const H = 20;
const word = (text, x0, y, conf = 95) => ({ text, x0, x1: x0 + text.length * 11, y0: y, y1: y + H, conf });
const right = (text, x1, y) => ({ ...word(text, x1 - text.length * 11, y) });
function page(lines, { heading = true, title = true } = {}) {
  const words = [];
  if (title) words.push(word('MADE-UP', 40, 40), word('BANK', 140, 40), word('Period', 40, 80), word('01/03/2025', 120, 80), word('31/03/2025', 260, 80), word('Printed', 600, 80), word('14/04/2025', 700, 80));
  if (heading) words.push(word('Date', 40, 160), word('Description', 200, 160), word('Withdrawal', 520, 160), word('Deposit', 700, 160), word('Balance', 900, 160));
  lines.forEach(([date, desc, wd, dp, bal], i) => {
    const y = 220 + i * 40;
    if (date) words.push(word(date, 40, y));
    desc.split(' ').forEach((t, k) => words.push(word(t, 200 + k * 90, y)));
    if (wd) words.push(right(wd, 640, y));
    if (dp) words.push(right(dp, 820, y));
    if (bal) words.push(right(bal, 1020, y));
  });
  return words;
}
const LINES = [
  ['', 'BROUGHT FORWARD', '', '', '1,000.00'],
  ['03/03/2025', 'Transfer in', '', '250.00', '1,250.00'],
  ['04/03/2025', 'Bill payment', '1,200.50', '', '49.50'],
  ['05/03/2025', 'Salary', '', '12,345.67', '12,395.17'],
  ['06/03/2025', 'Cash', '80.00', '', '12,315.17'],
];

test('a picture becomes a table: columns found from the picture, no bank layout needed', () => {
  const t = pictureTable(page(LINES), { w: 1100, h: 500 });
  assert.ok(t.ok, t.reason);
  assert.equal(t.headingFound, true);
  assert.deepEqual(t.rows[0].filter(Boolean), ['Date', 'Description', 'Withdrawal', 'Deposit', 'Balance']);
  const salary = t.rows.find(r => r.includes('Salary'));
  assert.ok(salary.includes('12,345.67') && salary.includes('12,395.17'));
  assert.equal(t.map.balance, t.rows[0].indexOf('Balance'));
  assert.equal(t.map.withdrawal, t.rows[0].indexOf('Withdrawal'));
  assert.equal(t.dayFirst, true, 'two dates over 12 (31/03, 14/04) show the dates are day first');
  assert.ok(t.other.some(o => o.includes('MADE-UP')), 'the bank name is kept apart, as other text');
});

test('the table it reads is proved by the balance like any spreadsheet', () => {
  const t = pictureTable(page(LINES), { w: 1100, h: 500 });
  const s = tableStatement('p.jpg', [{ name: 'p.jpg', rows: t.rows, dayFirst: t.dayFirst }], t.map,
    { openingText: '1,000.00', closingText: '12,315.17' });
  assert.equal(statusOf(s), 'yellow');
  assert.equal(s.rows.length, 4);
});

test('a time printed under its date stays on the same row', () => {
  const words = page(LINES);
  words.push(word('08:35', 40, 220 + 40 + 20));     // under the 03/03 date, half a line down
  const t = pictureTable(words, { w: 1100, h: 520 });
  const row = t.rows.find(r => r.includes('Transfer in') || r.some(c => c.startsWith('03/03/2025')));
  assert.match(row.join(' '), /03\/03\/2025 08:35/);
});

test('a blurred picture is refused, not guessed at', () => {
  const t = pictureTable(page(LINES).map(w => ({ ...w, conf: 20 })), { w: 1100, h: 500 });
  assert.equal(t.ok, false);
  assert.equal(t.code, 'too-blurry');
});

test('Download Excel: every picture\'s lines, in order, cells exactly as read', async () => {
  const a = pictureTable(page(LINES), { w: 1100, h: 500 });
  const b = pictureTable(page([['07/03/2025', 'Fee', '5.00', '', '12,310.17'], ['08/03/2025', 'Interest', '', '1.00', '12,311.17'], ['09/03/2025', 'Fee', '5.00', '', '12,306.17']]), { w: 1100, h: 400 });
  assert.ok(b.ok, b.reason);
  const bytes = pictureWorkbook([{ name: 'p1.jpg', ...a }, { name: 'p2.jpg', ...b }]);
  const [table, other] = await readXlsx(bytes);
  assert.equal(table.name, 'Table');
  const flat = table.rows.map(r => r.join('|'));
  assert.ok(flat.some(r => r.startsWith('1. p1.jpg|') && r.includes('12,345.67')));
  assert.ok(flat.some(r => r.startsWith('2. p2.jpg|') && r.includes('12,310.17')));
  assert.equal(flat.filter(r => r.includes('Balance')).length, 1, 'the same headings are not repeated');
  assert.ok(other.rows.some(r => r.join(' ').includes('MADE-UP')));
});

test('date order: a Thai bank named on the picture shows day-first; nothing on it shows nothing', () => {
  const short = LINES.map(([d, ...r]) => [d.replace(/^(\d\d)\/03/, '$1/04'), ...r]);   // days 1-12 only
  const plain = pictureTable(page(short, { title: false }), { w: 1100, h: 500 });
  assert.equal(plain.dayFirst, false, 'no day over 12, no bank name: the order is not shown');
  const named = pictureTable([...page(short, { title: false }), word('KASIKORNBANK', 40, 40)], { w: 1100, h: 500 });
  assert.equal(named.dayFirst, false, 'English headings: a Thai bank name alone does not show the order');
  const thai = pictureTable([...page(short, { title: false }).map(w => (w.text === 'Date' ? { ...w, text: 'วันที่' } : w)), word('KASIKORNBANK', 40, 40)], { w: 1100, h: 500 });
  assert.equal(thai.dayFirst, true, 'a Thai bank named in the title, above a Thai heading');
  const footer = pictureTable([...page(short, { title: false }), word('KASIKORNBANK', 40, 480)], { w: 1100, h: 520 });
  assert.equal(footer.dayFirst, false, 'below the table it shows nothing');
});

test('date order: a bank named inside the table, or inside another word, shows nothing (G8 picture review B1)', () => {
  // truth: month-first dates (03/04 = 4 March); a transfer to a Thai bank in a description
  const lines = [['', 'BROUGHT FORWARD', '', '', '1,000.00'], ['03/04/2025', 'To KRUNGTHAI', '10.00', '', '990.00'],
    ['04/05/2025', 'Fee', '10.00', '', '980.00'], ['05/06/2025', 'Fee', '10.00', '', '970.00'], ['06/09/2025', 'Fee', '10.00', '', '960.00']];
  const inside = pictureTable([...page(lines, { title: false }), word('30/09/2025', 40, 80)], { w: 1100, h: 500 });
  assert.equal(inside.dayFirst, false);
  const res = pictureLights([{ name: 'p', ...inside }], { openingText: '1,000.00', closingText: '960.00' });
  assert.ok(!res.rows[0].some(x => x?.light === 'green'), 'no either-way date is green');
  const glued = pictureTable([...page(lines.map(l => [l[0], l[1].replace('To KRUNGTHAI', 'Fee'), ...l.slice(2)]), { title: false }),
    word('BATT', 40, 40), word('BANK', 120, 40), word('30/09/2025', 40, 80)], { w: 1100, h: 500 });
  assert.equal(glued.dayFirst, false, '"BATT BANK" is not TTB');
});

test('date order: one date over 12 on the picture is not enough (it may be a misread)', () => {
  const short = LINES.map(([d, ...r]) => [d.replace(/^(\d\d)\/03/, '$1/04'), ...r]);
  const t = pictureTable([...page(short, { title: false }), word('30/04/2025', 600, 80)], { w: 1100, h: 500 });
  assert.equal(t.dayFirst, false);
});

// ---- traffic lights ------------------------------------------------------------
const lightsOf = (res, k = 0) => res.rows[k].map(x => x?.light ?? null);

test('lights: nothing typed - the lines add up but wait for a balance from the paper', () => {
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const res = pictureLights([t]);
  assert.deepEqual(lightsOf(res), [null, 'none', 'yellow', 'yellow', 'yellow', 'yellow']);
  assert.match(res.rows[0][2].why, /type the opening or closing balance/);
  assert.equal(res.set.light, 'yellow');
});

test('lights: both balances typed - every line proved; the set stays yellow', () => {
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const res = pictureLights([t], { openingText: '1,000.00', closingText: '12,315.17' });
  assert.deepEqual(lightsOf(res), [null, 'none', 'green', 'green', 'green', 'green']);
  assert.equal(res.set.light, SET_AT_MOST);
  assert.deepEqual(res.set.counts, { green: 4, yellow: 0, red: 0 });
});

test('lights: a cell fixed wrongly by hand turns its row red, and the set red', () => {
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const salary = t.rows.findIndex(r => r.includes('12,345.67'));
  t.rows[salary][t.rows[salary].indexOf('12,345.67')] = '12,345.76';
  const res = pictureLights([t], { openingText: '1,000.00', closingText: '12,315.17' });
  assert.equal(res.rows[0][salary].light, 'red');
  assert.match(res.rows[0][salary].why, /balance chain broken/);
  assert.equal(res.set.light, 'red');
  assert.ok(!res.rows[0].some(x => x?.light === 'green' && /12,345/.test(x.why)));
  assert.match(res.rows[0][salary + 1].why, /the line before it does not add up/, 'the reason names the real cause');
});

test('lights: a typed balance that disagrees makes the set red, and no row green', () => {
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const res = pictureLights([t], { openingText: '1,000.00', closingText: '12,999.00' });
  assert.equal(res.set.light, 'red');
  assert.ok(!lightsOf(res).includes('green'));
});

test('lights: a picture that could not be read makes the set red and is named', () => {
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const res = pictureLights([t, { name: 'p2.jpg', error: 'too blurry', rows: [] }], { openingText: '1,000.00', closingText: '12,315.17' });
  assert.equal(res.set.light, 'red');
  assert.ok(res.checks.some(c => !c.passed && c.detail.includes('p2.jpg')));
});

test('lights: two pictures with different columns are checked as one statement', () => {
  const a = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  // picture 2: one amount column with a minus for money out (its own dates show day-first)
  const words = [word('Date', 40, 160), word('Description', 200, 160), word('Amount', 700, 160), word('Balance', 900, 160)];
  [['13/03/2025', 'Fee', '-5.00', '12,310.17'], ['14/03/2025', 'Interest', '1.00', '12,311.17'], ['15/03/2025', 'Fee', '-5.00', '12,306.17'], ['16/03/2025', 'Interest', '2.00', '12,308.17']].forEach(([d, x, m, b], i) => {
    const y = 220 + i * 40;
    words.push(word(d, 40, y), word(x, 200, y), right(m, 820, y), right(b, 1020, y));
  });
  const b = { name: 'p2.jpg', ...pictureTable(words, { w: 1100, h: 400 }) };
  assert.ok(b.ok, b.reason);
  const res = pictureLights([a, b], { openingText: '1,000.00', closingText: '12,308.17' });
  assert.deepEqual(lightsOf(res, 1).slice(1), ['green', 'green', 'green', 'green']);
  assert.equal(res.set.counts.green, 8);
});

test('Download Excel with lights: a light and a why on every line, and a Checks sheet', async () => {
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const salary = t.rows.findIndex(r => r.includes('12,345.67'));
  t.rows[salary][t.rows[salary].indexOf('12,345.67')] = '12,345.76';      // a wrong fix by hand
  const typed = { openingText: '1,000.00', closingText: '12,315.17' };
  const lit = pictureLights([t, { name: 'p2.jpg', error: 'too blurry', rows: [] }], typed);
  const [table, , checks] = await readXlsx(pictureWorkbook([t, { name: 'p2.jpg', error: 'too blurry', rows: [] }], lit, typed));
  const head = table.rows[1];
  assert.equal(head[1], 'Light · ไฟ');
  assert.equal(head.at(-1), 'Why · เหตุผล');
  const bad = table.rows.find(r => r.includes('12,345.76'));
  assert.match(bad[1], /^Red/);
  assert.match(bad.at(-1), /balance chain broken/);
  assert.equal(checks.name, 'Checks');
  assert.match(checks.rows[0][1], /^Red/);
  assert.ok(checks.rows.some(r => r.join(' ').includes('p2.jpg')), 'the unread picture is named');
});

test('lights: a brought-forward word in a narrow text column still opens the account', () => {
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  // move "BROUGHT FORWARD" into a second, narrower text column, as a bank's channel column
  t.rows = t.rows.map((r, i) => [...r, i === 1 ? r[t.map.description] : '']);
  t.rows[1][t.map.description] = '';
  const res = pictureLights([t], { openingText: '1,000.00', closingText: '12,315.17' });
  assert.equal(res.rows[0][1].light, 'none');
  assert.equal(res.set.counts.green, 4);
});

test('Convert to Express sends exactly the green lines, nothing else', async () => {
  const { groupBatch } = await import('../../src/engine/batch.js');
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const salary = t.rows.findIndex(r => r.includes('12,345.67'));
  t.rows[salary][t.rows[salary].indexOf('12,345.67')] = '12,345.76';
  const lit = pictureLights([t], { openingText: '1,000.00', closingText: '12,315.17', name: 'p1.jpg' });
  const sent = groupBatch([lit.statement])[0].expressRows();
  const green = lit.rows[0].filter(x => x?.light === 'green').map(x => lit.statement.rows[x.at]);
  assert.deepEqual(sent.map(r => r.balance), green.map(r => r.balance));
  assert.ok(green.length > 0 && green.length < 4);
});

test('a cell reading "file 9 row 1" or holding control characters breaks nothing', async () => {
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const salary = t.rows.findIndex(r => r.includes('12,345.67'));
  t.rows[salary][t.rows[salary].indexOf('12,345.67')] = 'file 9 row 1';
  t.rows[salary][t.map.description] = 'Sal\u0001ary';
  const lit = pictureLights([t], { openingText: '1,000.00', closingText: '12,315.17' });
  assert.equal(lit.rows[0][salary].light, 'red');
  const [table] = await readXlsx(pictureWorkbook([t], lit));
  assert.ok(table.rows.some(r => r.includes('Salary')), 'the control character is dropped, the file still opens');
});

test('warnings reach the screen data and the Checks sheet (Co 2026-10-09: said, never acted on)', async () => {
  const t = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const lit = pictureLights([t], { openingText: '1,000.00', closingText: '12,315.17' });
  assert.equal(lit.warnings.length, 1, 'withdrawal and deposit columns: only the dates note');
  assert.equal(lit.set.counts.green, 4, 'nothing held');
  const [, , checks] = await readXlsx(pictureWorkbook([t], lit));
  assert.ok(checks.rows.some(r => r[0] === 'Check by eye · ตรวจด้วยตา' && /date/.test(r[2])));
});

test('two money columns on every line: the balance is the one whose change is an amount on its line', () => {
  // made-up SCB-like layout: one Debit/Credit column (money out left, money in right of it) and the balance;
  // the amount column has MORE dated lines than the balance (one balance blank), so only the chain picks the balance
  const words = [word('Date', 40, 160), word('Debit/Credit', 300, 160), word('Balance', 700, 160), word('Description', 820, 160)];
  const rows = [['', '', '1,000.00', 'BROUGHT FORWARD'], ['13/03/2025', '100.00', '900.00', 'Shop'], ['14/03/2025', '50.00', '850.00', 'Cafe'],
    ['15/03/2025', '25.00', '825.00(Food', ''], ['16/03/2025', '30.00', '', 'Taxi'], ['17/03/2025', '45.00', '750.00', 'Tea'],
    ['18/03/2025', '10.00', '740.00', 'Bus']];
  rows.forEach(([d, a, b, x], i) => {
    const y = 220 + i * 40;
    if (d) words.push(word(d, 40, y));
    if (a) words.push(right(a, 420, y));
    if (b) words.push(b.includes('(') ? word(b, 780 - 6 * 11, y) : right(b, 780, y));
    if (x) words.push(word(x, 820, y));
  });
  const t = pictureTable(words, { w: 1100, h: 500 });
  assert.ok(t.ok, t.reason);
  assert.equal(t.rows[0][t.map.balance], 'Balance');
  assert.ok(t.rows.some(r => r.includes('825.00')), 'the glued "825.00(Food" is split');
  const res = pictureLights([{ name: 'p', ...t }], { openingText: '1,000.00', closingText: '740.00' });
  assert.ok(res.set.counts.green >= 2 && res.set.counts.red + res.set.counts.yellow >= 1, 'the line with no balance is not green');
});

test('stray marks stuck to a figure ("8,765.43!") are dropped; words with letters are left as read', () => {
  const noisy = LINES.map(([d, x, wd, dp, bal], i) => [d, x, wd ? `${wd}!` : wd, dp, i === 2 ? `${bal};` : bal]);
  const t = pictureTable(page(noisy), { w: 1100, h: 500 });
  assert.ok(t.rows.some(r => r.includes('1,200.50')) && t.rows.some(r => r.includes('49.50')));
  assert.equal(pictureLights([{ name: 'p', ...t }], { openingText: '1,000.00', closingText: '12,315.17' }).set.counts.green, 4);
});

test('a date with lost separators is put back only where it falls in order', () => {
  const lines = [['', 'BROUGHT FORWARD', '', '', '1,000.00'], ['13/03/2025', 'a', '10.00', '', '990.00'], ['140325', 'b', '10.00', '', '980.00'],
    ['1503/2025', 'c', '10.00', '', '970.00'], ['1710/25', 'd', '10.00', '', '960.00'], ['16/03/2025', 'e', '10.00', '', '950.00']];
  const t = pictureTable(page(lines), { w: 1100, h: 500 });
  const dates = t.rows.slice(1).map(r => r[t.map.date]);
  assert.ok(dates.includes('14/03/25') && dates.includes('15/03/2025'), 'in order: repaired');
  assert.ok(dates.includes('1710/25'), 'out of order (17 Oct between 15 and 16 March): left as read');
});

test('page 2 with no title takes the date order shown on page 1; its own month-first dates win', () => {
  const p1 = { name: 'p1.jpg', ...pictureTable(page(LINES), { w: 1100, h: 500 }) };
  const short = [['07/04/2025', 'Fee', '5.00', '', '12,310.17'], ['08/04/2025', 'Interest', '', '1.00', '12,311.17'], ['09/04/2025', 'Fee', '5.00', '', '12,306.17'], ['10/04/2025', 'Interest', '', '2.00', '12,308.17']];
  const p2 = { name: 'p2.jpg', ...pictureTable(page(short, { title: false }), { w: 1100, h: 400 }) };
  assert.equal(p2.dayFirst, false, 'page 2 alone shows nothing');
  assert.ok(p2.ok, p2.reason);
  const res = pictureLights([p1, p2], { openingText: '1,000.00', closingText: '12,308.17' });
  assert.deepEqual(res.rows[1].slice(1).map(x => x.light), ['green', 'green', 'green', 'green']);
  const alone = pictureLights([p2], { openingText: '12,315.17', closingText: '12,308.17' });
  assert.ok(!alone.rows[0].some(x => x?.light === 'green'), 'on its own it stays to check');
  const mf = { ...p2, dateEvidence: 'month' };
  assert.ok(!pictureLights([p1, mf], { openingText: '1,000.00', closingText: '12,308.17' }).rows[1].some(x => x?.light === 'green'));
});

test('a transaction code read as "%2" or "x2" is put back as X2; nothing else is touched', () => {
  const words = page(LINES);
  ['', '%2', 'x1', '%20', 'X2'].forEach((c, i) => { if (c) words.push(word(c, 460, 220 + i * 40)); });
  const t = pictureTable(words, { w: 1100, h: 500 });
  const flat = t.rows.flat();
  assert.ok(flat.includes('X2') && flat.includes('X1'));
  assert.ok(flat.some(c => String(c).includes('%20')), 'more than one digit: left as read');
});

// ---- passbook pages and dot print (Co 2026-10-09: tick box, suggest only) ----

// What the passbook reader hands over: one entry per printed line. Invented.
const PB = [
  { page: 1, line: 1, date: '01/03/68', amount: null, balance: '*1,000.00', dateMargin: 0.2 },
  { page: 1, line: 2, date: '02/03/68', amount: '+250.00', balance: '*1,250.00', dateMargin: 0.2 },
  { page: 1, line: 3, date: '03/03/68', amount: '-200.50', balance: '*1,049.50', dateMargin: 0.01 },
  { page: 1, line: 4, date: null, amount: null, balance: null, dateMargin: null },
  { page: 2, line: 1, date: '04/03/68', amount: '+50.50', balance: '*1,100.00', dateMargin: 0.2 },
  { page: 2, line: 2, date: '05/03/68', amount: '+400.00', balance: '*1,500.00', dateMargin: 0.2 },
];

test('passbook pages become one table per page, the star dropped and the first line brought forward', () => {
  const [p1, p2] = passbookTables(PB, ['book - page 1', 'book - page 2']);
  assert.deepEqual(p1.rows, [['Date', 'Description', 'Amount', 'Balance'], ['01/03/68', 'B/F', '', '1,000.00'],
    ['02/03/68', '', '+250.00', '1,250.00'], ['03/03/68', '', '-200.50', '1,049.50']], 'an empty printed line is not a row');
  assert.equal(p2.rows.length, 3);
  assert.equal(p2.rows[1][1], '', 'only the book\'s first line is brought forward');
  assert.match(p1.doubts[3].note, /unsure of the date/);
  assert.equal(p1.doubts[3].date, '03/03/68');
});

test('passbook tables get the same lights; a date the reader was unsure of never shows green', () => {
  const tables = passbookTables(PB, ['book - page 1', 'book - page 2']);
  const lit = pictureLights(tables, { openingText: '1,000.00', closingText: '1,500.00' });
  assert.equal(lit.rows[0][1].light, 'none', 'B/F is the opening balance, not a line');
  assert.equal(lit.rows[0][2].light, 'green');
  assert.equal(lit.rows[0][3].light, 'yellow');
  assert.match(lit.rows[0][3].why, /unsure of the date/);
  assert.equal(lit.rows[1][2].light, 'green');
  assert.equal(lit.statement.opening, 100000);
});

test('dot print: a starred balance, a "+" read as "$" or "#", and a figure split at its comma are read as figures', () => {
  const words = page([]);
  const y = 220;
  words.push(word('03/03/2025', 40, y), word('Deposit', 200, y), right('$250.00', 820, y), right('*1,250.00', 1020, y));
  words.push(word('04/03/2025', 40, y + 40), word('Deposit', 200, y + 40), right('#40.00', 820, y + 40), right('*1,290.00', 1020, y + 40));
  // "-120," and "000.00" side by side, one character apart
  words.push(word('05/03/2025', 40, y + 80), word('Cheque', 200, y + 80), right('-120,', 562, y + 80), right('000.00', 640, y + 80), right('-118,710.00', 1020, y + 80));
  words.push(word('06/03/2025', 40, y + 120), word('Cash', 200, y + 120), right('1,000.00', 640, y + 120), right('*-117,710.00', 1020, y + 120));
  const t = pictureTable(words, { w: 1100, h: 500 });
  assert.ok(t.ok, t.reason);
  const cells = t.rows.slice(1).flat();
  for (const c of ['+250.00', '1,250.00', '+40.00', '1,290.00', '-120,000.00', '-117,710.00']) assert.ok(cells.includes(c), c);
  assert.ok(!cells.some(c => /[*$#]/.test(c)));
});

test('a "+" read as a "4" is suggested in the Why column, never changed (Co 2026-10-09)', () => {
  const t = { name: 'a.jpg', map: { date: 0, description: 1, amount: 2, balance: 3 }, dayFirst: true, dateEvidence: 'day',
    rows: [['Date', 'Description', 'Amount', 'Balance'], ['01/03/68', 'B/F', '', '1,000.00'], ['02/03/68', '', '+250.00', '1,250.00'],
      ['03/03/68', '', '4300.00', '1,550.00'], ['04/03/68', '', '+50.00', '1,600.00']] };
  const lit = pictureLights([t], { openingText: '1,000.00', closingText: '1,600.00' });
  assert.equal(lit.rows[0][3].light, 'red');
  assert.match(lit.rows[0][3].why, /may be \+300\.00 with the "\+" read as a 4/);
  assert.equal(t.rows[3][2], '4300.00', 'the cell is left as read');
  assert.ok(!/read as a 4/.test(lit.rows[0][2].why));
});


test('a date the reader was unsure of is held from Express too, not only from green (G8 B1)', () => {
  const tables = passbookTables(PB, ['book - page 1', 'book - page 2']);
  // everything adds up and both balances are typed: still not all of it goes
  const lit = pictureLights(tables, { openingText: '1,000.00', closingText: '1,500.00' });
  const s = lit.statement;
  const held = s.rows.find(r => r.date === '2025-03-03');
  assert.ok(held.notes.some(n => /unsure of the date/.test(n)), 'the doubt is a note on the line itself');
  const sent = partialRows(s);
  assert.ok(sent, 'a held line makes the result partial');
  assert.ok(!sent.includes(held), 'the unsure-date line is not sent to Express');
  assert.ok(rowsToCheck(s).includes(held), 'it is listed to check by hand');
  // the person corrects the date on screen: the doubt was about the date as read, so it goes
  tables[0].rows[3][0] = '04/03/68';
  const again = pictureLights(tables, { openingText: '1,000.00', closingText: '1,500.00' });
  assert.ok(!again.statement.rows.some(r => r.notes.some(n => /unsure of the date/.test(n))));
});

test('a passbook page with nothing read on it is said, not passed on empty (G8 N3)', () => {
  const [, p2] = passbookTables(PB.filter(l => l.page === 1), ['book - page 1', 'book - page 2']);
  assert.match(p2.error, /nothing was read/);
});

test('a page in dollars: "$" on most figures is the currency, not a "+" (G8 N1)', () => {
  const words = page([]);
  [['03/03/2025', '$250.00', '$1,250.00'], ['04/03/2025', '$40.00', '$1,210.00'], ['05/03/2025', '$10.00', '$1,200.00']].forEach(([d, a, b], k) => {
    const y = 220 + 40 * k;
    words.push(word(d, 40, y), word('Item', 200, y), right(a, 820, y), right(b, 1020, y));
  });
  const t = pictureTable(words, { w: 1100, h: 500 });
  assert.ok(t.ok, t.reason);
  const cells = t.rows.slice(1).flat();
  assert.ok(cells.includes('40.00') && cells.includes('1,210.00'));
  assert.ok(!cells.some(c => /^[+$]/.test(c)));
});


// G8 picture-v2 re-review: the unsure line is the one that shows the next
// line's confident misread (03/03, really 08/03) going backwards. Invented.
const NEIGHBOUR = [
  { page: 1, line: 1, date: '01/03/68', amount: null, balance: '*1,000.00', dateMargin: 0.2 },
  { page: 1, line: 2, date: '02/03/68', amount: '+250.00', balance: '*1,250.00', dateMargin: 0.2 },
  { page: 1, line: 3, date: '05/03/68', amount: '-200.50', balance: '*1,049.50', dateMargin: 0.01 },
  { page: 1, line: 4, date: '03/03/68', amount: '+50.50', balance: '*1,100.00', dateMargin: 0.3 },
  { page: 1, line: 5, date: '09/03/68', amount: '+400.00', balance: '*1,500.00', dateMargin: 0.3 },
];

test('a line read earlier than an unsure date above it is held, on the picture path (G8 re-review)', () => {
  const lit = pictureLights(passbookTables(NEIGHBOUR, ['book - page 1']), { openingText: '1,000.00', closingText: '1,500.00' });
  assert.notEqual(lit.rows[0][4].light, 'green');
  assert.match(lit.rows[0][4].why, /earlier than picture 1 line 3 above/);
  const s = lit.statement;
  assert.ok(!(partialRows(s) ?? []).some(r => r.date === '2025-03-03'), 'the misread date is not sent to Express');
});

test('the same on the Passbook card (G8 re-review)', () => {
  const s = passbookStatement('book.pdf', NEIGHBOUR, KTB_PASSBOOK);
  const misread = s.rows.find(r => r.date === '2025-03-03');
  assert.ok(misread.notes.some(n => /earlier than page 1 line 3 above/.test(n)));
  assert.ok(!(partialRows(s) ?? []).includes(misread));
});

// G8 picture-v2 review 3: a confident late misread two lines above a line
// going backwards, with an unsure line between. Invented.
const LATE_ABOVE = [
  { page: 1, line: 1, date: '01/03/68', amount: null, balance: '*1,000.00', dateMargin: 0.2 },
  { page: 1, line: 2, date: '02/03/68', amount: '+250.00', balance: '*1,250.00', dateMargin: 0.2 },
  { page: 1, line: 3, date: '09/03/68', amount: '-200.50', balance: '*1,049.50', dateMargin: 0.3 },
  { page: 1, line: 4, date: '09/03/68', amount: '+50.50', balance: '*1,100.00', dateMargin: 0.01 },
  { page: 1, line: 5, date: '05/03/68', amount: '+400.00', balance: '*1,500.00', dateMargin: 0.3 },
  { page: 1, line: 6, date: '06/03/68', amount: '+100.00', balance: '*1,600.00', dateMargin: 0.3 },
];

test('every line above that reads later than a backwards date is held, not only the one just above (G8 review 3)', () => {
  const lit = pictureLights(passbookTables(LATE_ABOVE, ['book - page 1']), { openingText: '1,000.00', closingText: '1,600.00' });
  assert.notEqual(lit.rows[0][3].light, 'green', 'the confident 09/03 two lines up');
  assert.match(lit.rows[0][3].why, /may be read too late/);
  assert.ok(!(partialRows(lit.statement) ?? []).some(r => r.date === '2025-03-09'));
  const card = passbookStatement('book.pdf', LATE_ABOVE, KTB_PASSBOOK);
  assert.ok(!(partialRows(card) ?? []).some(r => r.date === '2025-03-09'));
});

test('two confident late misreads in a row are both held on the Passbook card (G8 review 3)', () => {
  const lines = LATE_ABOVE.map(l => ({ ...l, dateMargin: l.dateMargin === null ? null : 0.3 }));
  const s = passbookStatement('book.pdf', lines, KTB_PASSBOOK);
  const late = s.rows.filter(r => r.date === '2025-03-09');
  assert.equal(late.length, 2);
  for (const r of late) assert.ok(r.notes.some(n => /may be read too late/.test(n)));
  assert.ok(!(partialRows(s) ?? []).some(r => r.date === '2025-03-09'));
});

// Passbook plan, Co 2026-10-09: step 2 fill (an unread date only), step 3 keep held. Invented.
const DAYS = [
  { page: 1, line: 1, date: '06/03/68', amount: null, balance: '*1,000.00', dateMargin: 0.2 },
  { page: 1, line: 2, date: '07/03/68', amount: '+100.00', balance: '*1,100.00', dateMargin: 0.2 },
  { page: 1, line: 3, date: null, amount: '+20.00', balance: '*1,120.00', dateMargin: null },
  { page: 1, line: 4, date: '07/03/68', amount: '+30.00', balance: '*1,150.00', dateMargin: 0.3 },
  { page: 1, line: 5, date: '02/03/68', amount: '+40.00', balance: '*1,190.00', dateMargin: 0.3 },
  { page: 1, line: 6, date: '07/03/68', amount: null, balance: '*1,240.00', dateMargin: 0.2 },
  { page: 1, line: 7, date: '07/03/68', amount: '+10.00', balance: '*1,250.00', dateMargin: 0.2 },
];

test('an unread passbook date between two same-day lines is filled in and said; a date read is only suggested', () => {
  const [t] = passbookTables(DAYS, ['book - page 1']);
  assert.equal(t.rows[3][0], '07/03/68', 'the unread date is filled in, in the cell');
  assert.equal(t.rows[5][0], '02/03/68', 'a date read is left as read');
  const lit = pictureLights([t], { openingText: '1,000.00', closingText: '1,250.00' });
  assert.match(lit.rows[0][3].why, /could not be read: filled in as 07\/03\/68/);
  assert.match(lit.rows[0][5].why, /lines either side both read 07\/03\/68 - it may be 07\/03\/68/);
  assert.notEqual(lit.rows[0][5].light, 'green');
  // step 3: the amount is said from the balances, never filled in, and the line stays held
  assert.match(lit.rows[0][6].why, /balance changed by \+50\.00 - that may be the amount/);
  assert.equal(lit.rows[0][6].light, 'red');
  assert.equal(t.rows[6][2], '');
  // the person changes the filled date: the note goes, it is theirs now
  t.rows[3][0] = '08/03/68';
  assert.ok(!/filled in/.test(pictureLights([t], { openingText: '1,000.00' }).rows[0][3].why));
});

test('no fill when a line either side was read unsurely, or the two days differ, or only the brought-forward line is above', () => {
  const unsure = DAYS.map(l => (l.line === 2 ? { ...l, dateMargin: 0.01 } : l));
  assert.equal(passbookTables(unsure, ['b'])[0].rows[3][0], '');
  const differ = DAYS.map(l => (l.line === 4 ? { ...l, date: '08/03/68' } : l));
  assert.equal(passbookTables(differ, ['b'])[0].rows[3][0], '');
  const bf = [{ ...DAYS[0], date: '07/03/68' }, { ...DAYS[2], line: 2 }, { ...DAYS[4], line: 3 }];
  assert.equal(passbookTables(bf, ['b'])[0].rows[2][0], '', 'the brought-forward date does not count');
});
