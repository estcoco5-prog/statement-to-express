// TH / EN: every note the checks write must come out in Thai on the Thai
// screen. The engine writes English (its own logic reads some notes), so these
// tests run real readings through it and look for English left over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thai, both, pair } from '../src/lang.js';
import { MESSAGES } from '../src/view.js';
import { readCsv } from '../src/table/read.js';
import { findColumns } from '../src/table/columns.js';
import { tableStatement } from '../src/table/statement.js';
import { pictureLights } from '../src/picture/lights.js';
import { buildChecks } from '../src/engine/verify.js';
import { groupBatch } from '../src/engine/batch.js';
import { expressFiles } from '../src/engine/output/express.js';

// What may stay in Latin letters on a Thai screen: file names, quoted cell
// text, product and field names.
const ALLOWED = /\b(?:Express|Excel|PDF|OK|DOCNUM|BNKACC|HEIC|Mac|JPEG|JPG|PNG|CSV|LINE|Rows to check|Review|xlsx|csv|xls)\b/g;
function english(text) {
  const rest = String(text)
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[\w-]+\.(?:csv|xlsx|jpg|pdf)\b/gi, '')
    .replace(ALLOWED, '');
  return /[A-Za-z]{3,}/.test(rest) ? rest : null;
}
const leftovers = texts => [...new Set(texts.filter(Boolean))].map(t => [t, english(thai(t))]).filter(([, e]) => e);

const CSV = `Statement of account
วันที่,รายการ,ถอน,ฝาก,คงเหลือ
,ยอดยกมา,,,"1,000.00"
15/01/2568,โอนเงินเข้า,,250.00,"1,250.00"
16/01/2568,ชำระบิล,"1,200.50",,49.50
,ค่าไฟฟ้า งวด 1,,,
17/02/2568,เงินเดือน,,"12,345.67","12,395.17"
18/02/2568,ถอนเงินสด,80.00,,"12,315.17"
,รวม TOTAL,"1,280.50","12,595.67",
`;
const table = (name, csv) => {
  const rows = readCsv(csv)[0].rows;
  const { map, header } = findColumns(rows);
  return { name, rows: rows.slice(header), map, dayFirst: true };
};
// Readings that go wrong in every way the checks know about.
const BROKEN = [
  ['misread amount', CSV.replace('"12,345.67","12,395.17"', '"12,845.67","12,395.17"')],
  ['unreadable amount', CSV.replace('"1,200.50"', '"1,2O0.5O"')],
  ['unreadable balance', CSV.replace(',49.50', ',4g.50')],
  ['unreadable date', CSV.replace('16/01/2568', '3l/1x/2568')],
  ['backwards date', CSV.replace('17/02/2568', '07/01/2568')],
  ['two amounts', CSV.replace(',250.00,"1,250.00"', '5.00,250.00,"1,250.00"')],
  ['no balance', CSV.replace(',80.00,,"12,315.17"', ',80.00,,')],
  ['no date', CSV.replace('18/02/2568', '')],
  ['month-first only', CSV.replace('17/02/2568', '02/17/2568')],
  ['either way', CSV.replace(/(\d\d)\/(\d\d)\/2568/g, (m, d, mo) => `${mo}/${String(Math.min(+d, 12)).padStart(2, '0')}/2568`)],
  ['repeated line', CSV.replace('18/02/2568,ถอนเงินสด,80.00,,"12,315.17"', '18/02/2568,ถอนเงินสด,80.00,,"12,315.17"\n18/02/2568,ถอนเงินสด,80.00,,"12,315.17"')],
];
const TYPED = [{}, { openingText: '1,000.00' }, { closingText: '12,315.17' },
  { openingText: '1,000.00', closingText: '12,315.17' }, { openingText: '0', closingText: '12,999.00' },
  { openingText: '1,500.00', closingText: '12,315.17' }];

function allTexts(res) {
  const out = [res.set.headline];
  for (const rows of res.rows) for (const r of rows) if (r) out.push(r.why);
  for (const c of res.checks) out.push(c.label, c.detail);
  for (const w of res.warnings) assert.ok(w.th, 'every warning carries its own Thai');
  return out;
}

test('every note on a picture reading comes out in Thai', () => {
  const texts = [];
  for (const typed of TYPED) {
    texts.push(...allTexts(pictureLights([table('p1.csv', CSV)], typed)));
    for (const [, csv] of BROKEN) texts.push(...allTexts(pictureLights([table('p1.csv', csv)], typed)));
    // two pages: the second does not carry on, or repeats the first
    texts.push(...allTexts(pictureLights([table('p1.csv', CSV), table('p2.csv', CSV)], typed)));
    texts.push(...allTexts(pictureLights([table('p1.csv', CSV), table('p2.csv', BROKEN[0][1])], typed)));
    // a picture that could not be read
    texts.push(...allTexts(pictureLights([table('p1.csv', CSV), { name: 'p2.jpg', error: MESSAGES['too-blurry'].en, rows: [] }], typed)));
    texts.push(...allTexts(pictureLights([{ name: 'p1.jpg', error: 'no column of amounts was found in this picture', rows: [] }], typed)));
    // nothing on the picture shows which way round its dates are written
    texts.push(...allTexts(pictureLights([{ ...table('p1.csv', CSV), dayFirst: false }], typed)));
    for (const [, csv] of BROKEN) texts.push(...allTexts(pictureLights([{ ...table('p1.csv', csv), dayFirst: false }], typed)));
  }
  assert.ok(texts.length > 200, `only ${texts.length} texts`);
  assert.deepEqual(leftovers(texts), []);
});

test('the bank PDF checks and the several-statements checks come out in Thai', () => {
  const rows = [
    { date: '2025-01-03', withdrawal: null, deposit: 25000, amount: 25000, verified: true, notes: [] },
    { date: '2025-01-02', withdrawal: 5000, deposit: null, amount: 5000, verified: false, notes: ['x'] },
    { date: '2025-03-09', withdrawal: 700, deposit: null, amount: 700, isTax: true, verified: true, notes: ['y'] },
  ];
  const facts = { closing_stated: 999, withdraw_total: 1, withdraw_count: 3, deposit_total: 2, deposit_count: 5,
    opening_derived: true, period_from: '01/01/2025', period_to: '31/01/2025' };
  const texts = buildChecks(100000, rows, 120000, facts).flat().filter(x => typeof x === 'string');
  // two readings of one account: the same days twice, then a gap
  const s1 = tableStatement('a.csv', [{ name: 'a.csv', rows: readCsv(CSV)[0].rows }], findColumns(readCsv(CSV)[0].rows).map,
    { account: '1112223334', openingText: '1,000.00', closingText: '12,315.17' });
  const s2 = tableStatement('b.csv', [{ name: 'b.csv', rows: readCsv(CSV)[0].rows }], findColumns(readCsv(CSV)[0].rows).map,
    { account: '1112223334', openingText: '1,000.00', closingText: '12,999.00' });
  for (const g of groupBatch([s1, s2])) {
    for (const c of g.checks) texts.push(c[0], c[2]);
    for (const s of g.statements) texts.push(g.leftOutReason(s));
  }
  for (const out of expressFiles(groupBatch([s2]))) texts.push(out.refused);
  assert.deepEqual(leftovers(texts), []);
});

test('the messages written once in the code come out in Thai', () => {
  const samples = [
    'the balance did not change, so whether 1,000.00 went in or out cannot be determined - check this row by hand',
    'balance chain broken: 1,000.00 -> 1,250.00 is a change of 250.00, but the amount printed is 520.00 (tax 1.50)',
    'the balance says this is a deposit, but it is printed in the withdrawal column - the balance was believed',
    'no balance was printed after this row, so it could not be checked against one',
    'these 3 rows share one printed balance, and they do not add up to it: 1,000.00 -> 1,500.00 is a change of 500.00, the rows net 100.00 + 300.00',
    'the reader was unsure of the date (reads 05/03/2025) - check the date',
    'the lines either side both read 05/03/2025 - it may be 05/03/2025; check the paper',
    'this may be +250.00 with the "+" read as a 4 - the balance agrees with 250.00; check the paper',
    'the balance changed by +1,250.00 - that may be the amount, if the balance above was read right; type it from the paper',
    'nothing was read on this page - check it is a printed passbook page, flat and whole',
    'fewer than 2 lines with amounts were found',
    'the date reads 05/03/1925, an unlikely year - check the date (picture 1 line 3)',
    'the same day, amount and balance as picture 1 line 4 - a repeated picture? check it',
    'shown as a withdrawal but the balance says deposit - check this line',
    'picture 2 does not carry on from the picture before it, or repeats its rows - check the order of the pictures',
    'gap: nothing covers 2025-02-01 to 2025-02-28',
    '31/01/2025 closes at 1,000.00 but 01/02/2025 opens at 1,500.00 (a.pdf, b.pdf)',
    'periods overlap: a.pdf, b.pdf',
    '01/01/2025 to 31/01/2025 appears in both a.pdf, b.pdf',
    'nothing to import - a.pdf: failed its own checks; b.pdf: no rows',
    '(account number not read)', '(period not read)', 'Spreadsheet from a picture (Excel → Express)',
    'this file is locked', 'the password is not right', 'this is not a PDF that can be opened',
    'no text found - this PDF is pictures only', 'this statement does not match any bank profile yet',
    'an unexpected problem stopped this file being read',
    'the statement period prints a 2-digit year (68) that cannot be read safely as Western or Buddhist - refusing to guess',
    'the statement period could not be read, so Buddhist and Western years cannot be told apart safely - refusing to guess',
    'the statement period could not be read, and this bank prints no year on its rows - refusing to guess',
    "two dates landed on one line (['01/01', '02/01']) - the row tolerance of 2.0pt is too generous for this statement",
    'the opening balance row (ยอดยกมา/B/F) was not found - without it the balance chain has no starting point',
    'the closing balance "12,3x" could not be read',
    // BBL Transaction Report (Co 2026-10-13)
    '"1.286,398.63" could not be read as a balance (file 1 row 3); "1.286,398.63" may be 1,286,398.63 (a comma and a dot mixed up) - the balance agrees with 1,286,398.63 - check the paper, then tap Use',
    'A month or more of the statement period has no lines (allowed, listed)',
    'no lines 2025-01-01 to 2025-01-31 - if the account was used then, this file may be cut short',
    'no lines 2025-12-01 to 2025-12-31; no lines 2025-01-01 to 2025-01-31 - if the account was used then, this file may be cut short',
    'the bank printed no totals to confirm it - the balance chain proves every line after the first',
    'this report lists its newest line first, but 2 date(s) go the other way (first: 2025-02-01 then 2025-03-20) - the order cannot be trusted',
    // as the browser showed it on a picture table (the date as text, not a number)
    '"04/03/2025" could be day-first or month-first, and the dates in this file do not prove which (picture 1 line 3) - check the date',
    'the date number 45720 (04/03/2025) could be day-first or month-first, and the dates in this file do not prove which (file 1 row 3) - check the date',
    ...Object.values(MESSAGES).map(m => m.en),
  ];
  assert.deepEqual(leftovers(samples), []);
});

test('a note no rule knows is shown as written, never dropped or garbled', () => {
  assert.equal(thai('something brand new happened'), 'something brand new happened');
  assert.equal(thai(''), '');
  // known parts are still translated around it
  assert.equal(thai('proved by the balance; something brand new'), 'ยอดคงเหลือยืนยันแล้ว; something brand new');
});

test('figures, dates and places survive translation exactly', () => {
  const th = thai('the date reads 07/01/2025, earlier than picture 1 line 4 above (16/01/2025) - check the date');
  assert.equal(th, 'วันที่อ่านได้ 07/01/2025 ซึ่งก่อนวันที่ของรูปที่ 1 บรรทัด 4 ข้างบน (16/01/2025) - ตรวจวันที่');
  assert.match(thai('balance chain broken: -1,000.00 -> 1,250.00 is a change of 2,250.00, but the amount printed is 520.00'),
    /-1,000\.00 -> 1,250\.00 .*2,250\.00 .*520\.00/);
});

test('texts written "English · ไทย" split into their two languages', () => {
  assert.deepEqual(both('Balance · คงเหลือ'), { en: 'Balance', th: 'คงเหลือ' });
  assert.deepEqual(both('a.xlsx · Sheet1'), pair('a.xlsx · Sheet1'));
  assert.equal(thai('Loading the photo reader (first time only, about 8 MB) · กำลังโหลดตัวอ่านรูป ครั้งแรกเท่านั้น'),
    'กำลังโหลดตัวอ่านรูป ครั้งแรกเท่านั้น');
});
