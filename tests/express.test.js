import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  excelSerial, remarkFor, buildBktrn, buildBatchProof, expressFileName, expressFiles, reviewFileName,
  BKTRN_FIELDS, DIRECTION_FIELDS,
} from '../src/engine/output/express.js';
import { buildWorkbook } from '../src/engine/output/review.js';
import { workbookParts, TODO, EXTRA, EXTRA_MONEY, EXTRA_HEAD, DATE } from '../src/engine/output/xlsx.js';
import { Row } from '../src/engine/extract.js';
import { groupBatch } from '../src/engine/batch.js';
import { PROFILES } from '../src/engine/profiles.js';
import { stmt, row } from './statements.js';
import { headerLines, openingLine, txLine } from './fixtures.js';
import { run } from './pipeline.js';

const { kbank: KBANK, ktb: KTB } = PROFILES;

// Port of the answer key's _express_row / EXPRESS_ROWS (all made up)
function expressRow(date, desc, { withdrawal, deposit, notes = [], channel = '', details = '' } = {}) {
  const r = new Row();
  r.date = date; r.description = desc; r.channel = channel; r.details = details;
  r.withdrawal = withdrawal ?? null; r.deposit = deposit ?? null; r.notes = [...notes];
  return r;
}
const ROWS = [
  expressRow('2026-06-09', 'โอนเงินเข้า จาก นาย ก', { deposit: 113000 }),
  expressRow('2026-06-10', 'ถอนเงินสด ATM', { withdrawal: 50000 }),
  expressRow('2026-06-11', 'X'.repeat(80), { deposit: 33050 }),
  expressRow('2026-06-12', '', { withdrawal: 200000, channel: 'ATM' }),
  expressRow('2026-06-13', 'ผิดพลาด', { withdrawal: 4200, notes: ['balance does not follow'] }),
];
const text = c => (c.value === null || c.value === undefined ? '' : c.value);
const grid = sheet => sheet.rows.map(r => r.map(c => (c.kind === 'float' && c.value !== '' ? String(c.value) : text(c))));

// Port of test_express_one_file_with_direction_columns
test('one Express sheet: every row, plus separate ถอน / ฝาก columns', () => {
  const sheet = buildBktrn(ROWS, null);
  const g = grid(sheet);
  assert.deepEqual(g[2].slice(0, 6), BKTRN_FIELDS);
  assert.deepEqual(g[2].slice(6), DIRECTION_FIELDS);
  assert.deepEqual([g[3][5], g[4][5]], ['โอนเงินเข้า จาก นาย ก', 'ถอนเงินสด ATM']);
  assert.equal(g[3][1], 46182);
  assert.equal(sheet.rows[3][1].style, DATE);
  assert.equal(g[4][3], '500');                          // AMOUNT positive for a withdrawal
  assert.deepEqual(g[3].slice(6), ['', '1130']);         // deposit in ฝาก
  assert.deepEqual(g[4].slice(6), ['500', '']);          // withdrawal in ถอน
  for (const r of sheet.rows.slice(3)) {
    assert.equal(r[3].value, (r[6].value || 0) + (r[7].value || 0));
  }
  assert.deepEqual([g[3][0], g[3][2], g[3][4]], ['', '', '']);
  assert.equal(g[5][5], 'X'.repeat(50));
  assert.equal(g[6][5], 'ATM');
  for (let r = 3; r < sheet.rows.length; r++) {
    assert.equal(sheet.rows[r][0].style, TODO);         // DOCNUM yellow
    assert.equal(sheet.rows[r][4].style, TODO);         // BNKACC yellow
    assert.notEqual(sheet.rows[r][2].style, TODO);      // DEPCOD optional, not yellow
  }
  assert.equal(sheet.rows[0][6].style, EXTRA_HEAD);
  assert.ok([EXTRA, EXTRA_MONEY].includes(sheet.rows[3][7].style));
});

// Port of test_express_obeys_the_template_instructions
test('the Express file obeys the template rules', () => {
  const g = groupBatch([stmt('kbank', '123-4-56789-0', '01/06/2026', '30/06/2026', '1000.00', '990.00',
    { rows: [row('2026-06-09', '10.00', '990.00')] })]);
  const [out] = expressFiles(g);
  const parts = Object.fromEntries(workbookParts([buildBktrn(g[0].expressRows(), null), buildBatchProof(g[0], 1000, 0)])
    .map(p => [p.name, p.text]));
  assert.ok(parts['xl/workbook.xml'].indexOf('name="BKTRN"') < parts['xl/workbook.xml'].indexOf('name="Proof"'));
  assert.ok(parts['xl/tables/table1.xml'].includes('ref="A3:H4"'));
  assert.ok(parts['xl/tables/table1.xml'].includes(
    [...BKTRN_FIELDS, ...DIRECTION_FIELDS].map((f, i) => `<tableColumn id="${i + 1}" name="${f}"/>`).join('')));
  assert.ok(parts['xl/worksheets/sheet1.xml'].indexOf('</sheetData>') < parts['xl/worksheets/sheet1.xml'].indexOf('<tableParts'));
  assert.equal(buildBktrn([], null).table, null);
  assert.ok(out.bytes.length > 1000);
});

// Port of test_kbank_remark_uses_full_details
test('KBank REMARK carries the full details, not the type', () => {
  const r = expressRow('2026-06-09', 'โอนเงิน', { deposit: 1000, details: 'โอนไป X0000 นาย ก' });
  assert.equal(remarkFor(r, KBANK.remarkFields), 'โอนไป X0000 นาย ก');
  r.details = '';
  assert.equal(remarkFor(r, KBANK.remarkFields), 'โอนเงิน');
});

test('KTB REMARK joins type and details', () => {
  const r = expressRow('2025-10-10', 'เงินโอนเข้า', { deposit: 1000, details: '000-1112223334' });
  assert.equal(remarkFor(r, KTB.remarkFields), 'เงินโอนเข้า 000-1112223334');
});

test('Excel serial for a Thai-relevant date', () => assert.equal(excelSerial('2026-06-09'), 46182));

test('REMARK is cut at 50 characters, not 50 UTF-16 units', () => {
  const r = new Row(); r.description = 'ก'.repeat(60);
  assert.equal([...remarkFor(r, null)].length, 50);
});

test('a row whose date could not be read keeps a blank DOCDAT, not a wrong one', () => {
  const sheet = buildBktrn([expressRow('01/40/25', 'x', { withdrawal: 100 })], null);
  assert.equal(sheet.rows[3][1].value, '');
  assert.equal(sheet.rows[3][1].style, DATE);
});

test('file names: bank, last 4 digits, month span', () => {
  const g = groupBatch([
    stmt('scb', '123-456789-0', '01/07/2026', '31/07/2026', '100.00', '90.00', { rows: [row('2026-07-02', '10.00', '90.00')] }),
    stmt('scb', '123-456789-0', '01/08/2026', '31/08/2026', '90.00', '80.00', { rows: [row('2026-08-02', '10.00', '80.00')] }),
  ]);
  assert.equal(expressFileName(g[0]), 'SCB_7890_202607-202608_BKTRN.xlsx');
  const noAccount = groupBatch([stmt('scb', null, '01/07/2026', '31/07/2026', '1.00', '1.00', { name: 'July stmt.PDF' })]);
  assert.equal(expressFileName(noAccount[0]), 'SCB_July stmt_202607-202607_BKTRN.xlsx');
  assert.equal(reviewFileName('July stmt.PDF'), 'July stmt.xlsx');
});

// Review Focus #5
test('an account whose every month failed gets no Express file', () => {
  const g = groupBatch([stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '90.00',
    { ok: false, rows: [row('2026-07-02', '10.00', '90.00')] })]);
  const [out] = expressFiles(g);
  assert.ok(out.refused);
  assert.equal(out.bytes, undefined);
});

test('the batch Proof lists every statement, left-out ones with their reason', () => {
  const a = stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '90.00', { name: 'a.pdf', rows: [row('2026-07-02', '10.00', '90.00')] });
  const b = stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '90.00', { name: 'b.pdf', rows: [row('2026-07-02', '10.00', '90.00')] });
  const [g] = groupBatch([a, b]);
  const proof = grid(buildBatchProof(g, 1000, 123456));
  const flat = proof.map(r => r.join(' | '));
  assert.ok(flat.includes('Withdrawals (ถอน) |  | 10.00'), flat.join('\n'));
  assert.ok(flat.includes('Deposits (ฝาก) |  | 1,234.56'));
  assert.ok(flat.some(l => l.startsWith('b.pdf | LEFT OUT | 01/07/2026 to 31/07/2026 - same days as a.pdf')));
  assert.ok(flat.some(l => l.startsWith('LEFT OUT statements are NOT in this file')));
});

// Port of the workbook half of test_daily_summary_ties_back_to_the_transactions
test('the Review workbook carries Transactions, Daily and Proof', () => {
  const page = [...headerLines(), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' }),
    ...txLine(217, { date: '19-06-26', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '21,299.99' })];
  const { facts, opening, rows, closing, checks } = run([page]);
  const sheets = buildWorkbook(rows, opening, closing, facts, checks, KBANK, 'x.pdf');
  assert.deepEqual(sheets.map(s => s.name), ['Transactions', 'Daily', 'Proof']);
  const tx = grid(sheets[0]);
  assert.deepEqual(tx[1].slice(0, 3), ['2026-06-01', '', 'Opening balance']);
  assert.equal(tx[2][8], 'OK');
  assert.equal(grid(sheets[1]).length, 1 + 30 + 1);       // header, 30 days of June, totals
  assert.deepEqual(grid(sheets[1]).at(-1).slice(0, 2), ['30 days, 2 active', 2]);
  const proof = grid(sheets[2]).map(r => r.join(' | '));
  assert.ok(proof.includes('Source PDF |  | x.pdf'));
  assert.ok(proof.includes('Account number |  | 123-4-56789-0'));
  assert.ok(proof.includes('Transactions read |  | 2'));
});

test("every Express file carries the template's อ่านก่อน sheet as its 2nd tab", () => {
  const [out] = expressFiles(groupBatch([stmt('scb', '1112223334', '01/07/2026', '31/07/2026', '100.00', '90.00',
    { rows: [row('2026-07-02', '10.00', '90.00')] })]));
  assert.deepEqual(out.sheets.map(s => s.name), ['BKTRN', 'อ่านก่อน', 'Proof']);
  const parts = Object.fromEntries(workbookParts(out.sheets).map(p => [p.name, p.text]));
  assert.match(parts['xl/worksheets/sheet2.xml'], /รายละเอียดการกรอกข้อมูลในไฟล์ Excel ก่อนนำเข้าสู่โปรแกรม X Import/);
  assert.match(parts['xl/worksheets/sheet2.xml'], /<c r="G4" s="6"><v>45301<\/v><\/c>/);   // the example date
});
