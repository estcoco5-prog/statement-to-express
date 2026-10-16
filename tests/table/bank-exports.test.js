// A bank's OWN export (Co 2026-10-16): CSV, old .xls, HTML saved as .xls -
// the description column chosen well, 0.00 lines left out, the bank's totals
// line used as a check. Every figure and name is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTableFile, readCsv, decodeText } from '../../src/table/read.js';
import { findColumns } from '../../src/table/columns.js';
import { tableStatement } from '../../src/table/statement.js';
import { statusOf } from '../../src/engine/statement.js';
import { groupBatch } from '../../src/engine/batch.js';
import { miniXls } from './minixls.js';

const heading = (csvHead) => readCsv(`${csvHead}\n`)[0].rows;

test('the description is the column that names the transaction, not the first one a word fits', () => {
  // SCB Business export: "Currency Code" and "Tr Description" come before "Description"
  const scb = findColumns(heading('Account Number,Currency Code,Date,Time,Tr Code,Tr Description,Channel,Withdrawal,Deposit,Outstanding Balance,Description'));
  assert.equal(scb.map.description, 10);
  // ttb business one: a type code and a channel come before the real description
  const ttb = findColumns(heading('เลขที่บัญชี,วันที่ทำรายการ,วันที่มีผล,รหัสประเภทรายการ,ถอน,ฝาก,ยอดคงเหลือ,ช่องทางทำรายการ,รายละเอียดการทำธุรกรรม,รายละเอียดเพิ่มเติม'));
  assert.equal(ttb.map.description, 8);
  assert.equal(ttb.map.date, 1, 'the transaction date, not the effective date');
  // UOB Business: "Value Date" before "Date"
  const uob = findColumns(heading('D1,Account Number,Value Date,Date,Time,Description,Deposit,Withdrawal,Ledger Balance'));
  assert.equal(uob.map.date, 3);
  assert.equal(uob.map.description, 5);
  // a plain statement keeps its plain headings
  assert.deepEqual(findColumns(heading('วันที่,รายการ,ถอน,ฝาก,คงเหลือ')).map, { date: 0, description: 1, withdrawal: 2, deposit: 3, balance: 4 });
});

const EXPORT = `Date,Description,Withdrawal,Deposit,Balance
01/06/2026,MADE-UP TRANSFER IN,,"1,000.00","1,500.00"
02/06/2026,MADE-UP CHEQUE FEE,0.00,,"1,500.00"
02/06/2026,MADE-UP CHEQUE FEE,0.00,,"1,500.00"
13/06/2026,MADE-UP PAYMENT,200.00,,"1,300.00"
14/06/2026,MADE-UP PAYMENT,300.00,,"1,000.00"
`;

test('a 0.00 line moves no money: left out and listed, and it holds nothing around it', () => {
  const rows = readCsv(EXPORT)[0].rows;
  const s = tableStatement('export.csv', [{ name: 'export.csv', rows }], findColumns(rows).map,
    { openingText: '500.00', closingText: '1,000.00' });
  assert.equal(s.rows.length, 3);
  assert.deepEqual(s.skipped, ['file 1 row 3: 0.00 - nothing to post', 'file 1 row 4: 0.00 - nothing to post']);
  const listed = s.checks.find(([label]) => label.startsWith('Lines of 0.00 left out'));
  assert.ok(listed && listed[1]);
  const [g] = groupBatch([s]);
  assert.equal(g.expressRows().length, 3, 'every money line goes, none held by the 0.00 lines');
  assert.equal(statusOf(s), 'yellow');
});

test('a 0.00 line whose balance moved is a misread, never left out', () => {
  const rows = readCsv(EXPORT.replace('0.00,,"1,500.00"\n02/06', '0.00,,"1,400.00"\n02/06'))[0].rows;
  const s = tableStatement('export.csv', [{ name: 'export.csv', rows }], findColumns(rows).map, { openingText: '500.00' });
  // the first 0.00 moved the balance (1,500 -> 1,400); the second then "moves" it back: both stay
  assert.equal(s.rows.length, 5, 'a 0.00 beside a moving balance stays, to be checked');
  assert.deepEqual(s.skipped, []);
});

const UOB_LIKE = `" D1 "," Account Number "," Value Date "," Date "," Description "," Deposit "," Withdrawal "," Ledger Balance "
" D2 "," 9999999999 "," 01/06/2026 "," 01/06/2026 "," MADE-UP DEP "," 500.00 "," 0.00 "," 1,500.00 "
" D2 "," 9999999999 "," 13/06/2026 "," 13/06/2026 "," MADE-UP CASH "," 0.00 "," 200.00 "," 1,300.00 "
" D2 "," 9999999999 "," 14/06/2026 "," 14/06/2026 "," MADE-UP FEE "," 0.00 "," 3.00 "," 1,297.00 "
" T ","","","",""," 500.00 "," 203.00 ",""
`;

test("the bank's totals line is used as a check when it adds up - and stays a line to check when not", () => {
  const rows = readCsv(UOB_LIKE)[0].rows;
  const s = tableStatement('uob.csv', [{ name: 'uob.csv', rows }], findColumns(rows).map,
    { openingText: '1,000.00', closingText: '1,297.00' });
  assert.equal(s.rows.length, 3);
  assert.ok(s.skipped.some(t => /totals line - used as a check/.test(t)));
  for (const label of ["Total withdrawals matches the bank's own total", "Total deposits matches the bank's own total"]) {
    assert.ok(s.checks.find(([l, ok]) => l === label && ok), label);
  }
  assert.equal(groupBatch([s])[0].expressRows().length, 3);

  const wrong = readCsv(UOB_LIKE.replace('" 203.00 "', '" 999.00 "'))[0].rows;
  const w = tableStatement('uob.csv', [{ name: 'uob.csv', rows: wrong }], findColumns(wrong).map,
    { openingText: '1,000.00', closingText: '1,297.00' });
  assert.equal(w.rows.length, 4, 'a "totals" line that does not add up is never dropped');
  assert.ok(w.rows[3].notes.length);
});

test('a CSV in the Thai Windows code page reads as Thai, not question marks', async () => {
  // "วันที่,รายการ" in TIS-620 / windows-874
  const tis = new Uint8Array([0xc7, 0xd1, 0xb9, 0xb7, 0xd5, 0xe8, 0x2c, 0xc3, 0xd2, 0xc2, 0xa1, 0xd2, 0xc3]);
  assert.equal(decodeText(tis), 'วันที่,รายการ');
  const [sheet] = await readTableFile('tis.csv', tis);
  assert.deepEqual(sheet.rows[0], ['วันที่', 'รายการ']);
  assert.equal(decodeText(new TextEncoder().encode('ยอดยกมา')), 'ยอดยกมา', 'UTF-8 stays UTF-8');
});

const XLS_ROWS = [
  ['วันที่', 'รายการ', 'ถอนเงิน', 'ฝากเงิน', 'ยอดเงินคงเหลือ'],
  ['01-มิ.ย.-2569', 'รับโอนเงิน จาก X0000 MADE-UP', '', { rk: 500 }, 1500.25],
  ['02-มิ.ย.-2569', 'ค่าธรรมเนียม', { rk100: 8 }, '', 1492.25],
  ['03-มิ.ย.-2569', 'โอนเงิน MADE-UP', 2000, '', -507.75],
];

for (const big of [false, true]) {
  test(`an old .xls (Excel 97-2003, ${big ? 'large' : 'small'} file) is read: Thai text, numbers, both compressed forms`, async () => {
    const sheets = await readTableFile('kbiz.xls', miniXls(XLS_ROWS, { big, splitText: true }));
    assert.equal(sheets.length, 1);
    const rows = sheets[0].rows;
    assert.deepEqual(rows[0], XLS_ROWS[0]);
    assert.deepEqual(rows[1], ['01-มิ.ย.-2569', 'รับโอนเงิน จาก X0000 MADE-UP', '', 500, 1500.25]);
    assert.deepEqual(rows[2].slice(0, 3), ['02-มิ.ย.-2569', 'ค่าธรรมเนียม', 8]);
    assert.equal(rows[3][4], -507.75);
    // and the Excel card checks it like any other sheet - dates written 01-มิ.ย.-2569
    const s = tableStatement('kbiz.xls', [{ name: 'kbiz.xls', rows }], findColumns(rows).map,
      { openingText: '1,000.25', closingText: '-507.75' });
    assert.deepEqual(s.rows.map(r => r.date), ['2026-06-01', '2026-06-02', '2026-06-03']);
    assert.ok(s.rows.every(r => r.verified));
    assert.equal(groupBatch([s])[0].expressRows().length, 3);
  });
}

test('an .xls that is really an HTML table, or text, is read too; anything else is refused plainly', async () => {
  const html = new TextEncoder().encode('<html><table><tr><th>วันที่</th><th>รายการ</th><th>คงเหลือ</th></tr>' +
    '<tr><td>01/06/2026</td><td>MADE-UP&nbsp;CO &amp; SONS</td><td>1,000.00</td></tr></table></html>');
  const [h] = await readTableFile('export.xls', html);
  assert.deepEqual(h.rows, [['วันที่', 'รายการ', 'คงเหลือ'], ['01/06/2026', 'MADE-UP CO & SONS', '1,000.00']]);
  const [t] = await readTableFile('export.xls', new TextEncoder().encode('วันที่\tรายการ\n01/06/2026\tMADE-UP\n'));
  assert.deepEqual(t.rows[1], ['01/06/2026', 'MADE-UP']);
  await assert.rejects(readTableFile('junk.xls', new TextEncoder().encode('nothing here at all')), e => e.code === 'old-xls');
});
