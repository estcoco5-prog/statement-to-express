// The downloaded Excel files in Thai (src/lang-excel.js): our words change,
// the Express template's parts and everything read from a statement do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thaiSheets } from '../src/lang-excel.js';
import { readCsv, readXlsx, readTableFile } from '../src/table/read.js';
import { findColumns } from '../src/table/columns.js';
import { tableStatement } from '../src/table/statement.js';
import { groupBatch } from '../src/engine/batch.js';
import { expressFiles } from '../src/engine/output/express.js';
import { buildWorkbook } from '../src/engine/output/review.js';
import { pictureLights } from '../src/picture/lights.js';
import { pictureWorkbook } from '../src/picture/excel.js';

const CSV = `Statement of account
วันที่,รายการ,ถอน,ฝาก,คงเหลือ
,ยอดยกมา,,,"1,000.00"
15/01/2568,TRANSFER IN Check OK,,250.00,"1,250.00"
16/01/2568,ชำระบิล,"1,200.50",,49.50
17/02/2568,Opening balance,,"12,845.67","12,395.17"
18/02/2568,ถอนเงินสด,80.00,,"12,315.17"
`;
const rows = readCsv(CSV)[0].rows;
const { map } = findColumns(rows);
// a misread line: some lines go to Express, the rest to Rows to check
const statement = tableStatement('page1.csv', [{ name: 'page1.csv', rows }], map,
  { account: '1112223334', openingText: '1,000.00', closingText: '12,315.17' });
const copy = sheets => JSON.parse(JSON.stringify(sheets.map(s => ({ name: s.name, rows: s.rows.map(r => r.map(c => c.value)) }))));
const cells = sheet => sheet.rows.flat().map(c => c.value).filter(v => typeof v === 'string' && v.trim());
const ALLOWED = /\b(?:Express|Excel|PDF|DOCNUM|BNKACC|BKTRN|X Import|Cell|STKCOD|IV\d+|K1|Mac|Windows)\b/g;
const english = v => /[A-Za-z]{3,}/.test(String(v).replace(/"[^"]*"/g, '').replace(/[\w-]+\.(?:csv|xlsx|pdf|jpg)\b/g, '').replace(ALLOWED, ''));

test('the Express file: template parts untouched, our sheets in Thai, statement data as read', () => {
  const [out] = expressFiles(groupBatch([statement]));
  assert.ok(out.sheets.some(s => s.name === 'Rows to check'), 'the sample must have lines to check');
  const before = copy(out.sheets);
  const th = thaiSheets(out.sheets);
  const bktrn = th.find(s => s.name === 'BKTRN');
  assert.deepEqual(copy([bktrn])[0], before.find(s => s.name === 'BKTRN'), 'BKTRN - rows 1-3 and every data row - unchanged');
  assert.deepEqual(copy([th.find(s => s.name === 'อ่านก่อน')])[0], before.find(s => s.name === 'อ่านก่อน'));
  assert.equal(th[0].name, 'BKTRN', 'the import sheet stays sheet 1');
  assert.deepEqual(th.map(s => s.name), ['BKTRN', 'อ่านก่อน', 'การตรวจสอบ', 'รายการที่ต้องตรวจ']);
  const check = th.find(s => s.name === 'รายการที่ต้องตรวจ');
  const was = before.find(s => s.name === 'Rows to check');
  // descriptions, dates and amounts on Rows to check are the statement's
  check.rows.slice(2).forEach((r, i) => [0, 1, 2, 3, 4, 5, 6].forEach(c =>
    assert.equal(r[c]?.value, was.rows[i + 2][c], `row ${i + 3} col ${c}`)));
  for (const sheet of th.filter(s => !['BKTRN', 'อ่านก่อน', 'รายการที่ต้องตรวจ'].includes(s.name))) {
    assert.deepEqual(cells(sheet).filter(english), [], sheet.name);
  }
  assert.deepEqual([...cells({ rows: check.rows.slice(0, 2) }), ...check.rows.slice(2).map(r => r[7].value)].filter(english), []);
});

test('the Review file: headings, checks and notes in Thai; descriptions as read, even ones that look like our words', () => {
  const before = copy(buildWorkbook(statement.rows, statement.opening, statement.closing, statement.facts, statement.checks,
    statement.profile, statement.name, statement.fromPhoto));
  const th = thaiSheets(buildWorkbook(statement.rows, statement.opening, statement.closing, statement.facts, statement.checks,
    statement.profile, statement.name, statement.fromPhoto));
  assert.deepEqual(th.map(s => s.name), ['รายการ', 'รายวัน', 'การตรวจสอบ']);
  const tx = th[0];
  assert.equal(tx.rows[0][0].value, 'วันที่');
  assert.equal(tx.rows[1][2].value, 'ยอดยกมา');
  assert.equal(tx.rows.at(-1)[2].value, 'ยอดคงเหลือปลายงวด');
  // a description reading "Opening balance" or "Check OK" mid-statement is the bank's text
  const mid = tx.rows.slice(2, -1).map(r => r[2].value);
  assert.deepEqual(mid, before[0].rows.slice(2, -1).map(r => r[2]));
  assert.ok(mid.includes('Opening balance') && mid.includes('TRANSFER IN Check OK'));
  // every date, amount and balance cell is the same value as before
  tx.rows.slice(1).forEach((r, i) => [0, 3, 4, 5].forEach(c => assert.equal(r[c]?.value, before[0].rows[i + 1][c])));
  assert.deepEqual(tx.rows.slice(1).map(r => r[8]?.value).filter(english), []);
  assert.deepEqual(cells(th[1]).filter(english), []);
  assert.deepEqual(cells(th[2]).filter(v => english(v) && !/page1\.csv|Spreadsheet/.test(v)), []);
});

test('Picture -> Excel in Thai: our words Thai, the cells as read, and the app still knows its own file', async () => {
  const t = { name: 'p1.csv', rows: rows.slice(1), map, dayFirst: true };
  const lit = pictureLights([t], { openingText: '1,000.00', closingText: '12,315.17' });
  const book = await readXlsx(pictureWorkbook([t], lit, { openingText: '1,000.00' }, 'th'));
  assert.deepEqual(book.map(s => s.name), ['ตาราง', 'ข้อความอื่น', 'การตรวจ']);
  const [table, , checks] = book;
  assert.equal(table.rows[0][0], 'อ่านจากรูปใบแจ้งยอดในเครื่องนี้ ตรวจทุกตัวเลขเทียบกับรูปก่อนใช้');
  assert.deepEqual(table.rows[1].slice(0, 2), ['รูป', 'สถานะ']);
  assert.equal(table.rows[1].at(-1), 'เหตุผล');
  // the picture's own headings and cells, exactly as read
  assert.deepEqual(table.rows[1].slice(2, 2 + rows[1].length), rows[1]);
  assert.deepEqual(table.rows.slice(2).map(r => r.at(-1)).filter(english), []);
  assert.deepEqual(checks.rows.flat().filter(v => typeof v === 'string' && english(v)), []);
  await assert.rejects(readTableFile('back.xlsx', pictureWorkbook([t], lit, {}, 'th')), { code: 'own-picture-file' });
  // English stays as it was
  const en = await readXlsx(pictureWorkbook([t], lit, {}, 'en'));
  assert.equal(en[0].name, 'Table');
  assert.match(en[0].rows[0][0], /^Read from statement pictures on this computer/);
});
