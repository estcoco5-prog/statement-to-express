// Business-account statement forms (Co 2026-10-16): SCB Business, KBank
// K-BIZ, ttb business one, UOB Business, EXIM Bank, and the "Account Activity
// History Report". Made-up figures and names, at the x positions measured off
// real statements. Thai words go in as ActualText over placeholder letters
// (5pt each), the way some banks' own PDFs carry them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pdfjs from './pdfjs.js';
import { miniPdf } from './minipdf.js';
import { readStatement, statusOf } from '../src/engine/statement.js';
import { groupBatch } from '../src/engine/batch.js';
import { expressFiles, BKTRN_FIELDS } from '../src/engine/output/express.js';
import { identify } from '../src/engine/profiles.js';

const th = (text, letters = 8) => [[ 'x'.repeat(letters), text ]];
// Each line written right to left: two Thai spans side by side would otherwise
// be glued into one word (the rule that rebuilds UOB's letter-by-letter Thai).
const read = lines => readStatement('made-up.pdf', miniPdf([...lines].sort((a, b) => a[1] - b[1] || b[0] - a[0])), [], null, pdfjs);
const check = (s, start) => s.checks.find(([label]) => label.startsWith(start));

test('SCB Business: a description split above and below its line, an overdrawn balance, a 0.00 fee', async () => {
  const s = await read([
    [16, 56, th('รายการเดินบัญชีย้อนหลัง', 16)], [16, 66, 'Historical Statement'],
    [16, 98, th('ชื่อบัญชี:')], [300, 98, th('เลขที่บัญชี:', 10)], [365, 98, '999-000000-0'],
    [469, 98, '(Start): 01/06/2026'], [469, 110, '(End): 30/06/2026'],
    [23, 205, 'Date/Time'], [201, 205, 'Withdrawal'], [377, 205, 'Balance'], [409, 205, 'Description'],
    [230, 239, th('ยอดยกมา')], [365, 239, '-1,000.00'],
    [409, 257, 'DCP 999 MADE-UP'],
    [23, 262, '01/06/2026'], [67, 262, '09:00'], [90, 262, 'X1'], [120, 262, 'BCMS'], [298, 262, '5,000.00'], [365, 262, '4,000.00'],
    [409, 267, 'CO.,L'],
    [23, 288, '02/06/2026'], [67, 288, '10:00'], [90, 288, 'QW'], [120, 288, 'AIP'], [154, 288, '00012345'],
    [223, 288, '1,500.00'], [365, 288, '2,500.00'], [409, 288, th('เช็คเรียกเก็บอัตโนมัติ')],
    [23, 314, '03/06/2026'], [67, 314, '10:04'], [90, 314, 'RC'], [120, 314, 'TELL'], [154, 314, '00012346'],
    [240, 314, '0.00'], [365, 314, '2,500.00'], [409, 314, 'MADE-UP BRANCH'],
    [23, 340, '04/06/2026'], [67, 340, '11:00'], [90, 340, 'X2'], [120, 340, 'BCMS'], [223, 340, '3,000.00'],
    [370, 340, '-500.00'], [409, 340, 'OVERDRAWN TEST'],
    [230, 380, th('ยอดยกไป')], [370, 380, '-500.00'],
    [16, 400, th('จำนวนเงินนำเข้าบัญชีทั้งหมด')],
    [16, 410, '1'], [24, 410, th('รายการ', 6)], [60, 410, '(Items) 5,000.00'],
    [16, 420, 'Total Credit Amount'],
    [16, 430, th('จำนวนเงินที่หักบัญชีทั้งหมด')],
    [16, 440, '3'], [24, 440, th('รายการ', 6)], [60, 440, '(Items) 4,500.00'],
    [16, 460, 'For more information, please call 02-722-2222'],
  ]);
  assert.equal(s.profile.key, 'scbbiz');
  assert.equal(s.opening, -100000, 'a minus balance is read as overdrawn');
  assert.deepEqual(s.rows.map(r => r.date), ['2026-06-01', '2026-06-02', '2026-06-04'], 'the 0.00 fee is left out');
  assert.equal(s.rows[0].description, 'DCP 999 MADE-UP CO.,L', 'the half above and the half below');
  assert.equal(s.rows[0].deposit, 500000);
  assert.equal(s.rows[2].balance, -50000);
  assert.equal(s.facts.account_no, '999-000000-0');
  assert.deepEqual([s.facts.period_from, s.facts.period_to], ['01/06/2026', '30/06/2026']);
  const count = check(s, 'Number of withdrawals');
  assert.ok(count[1] && /2 \+ 1 line\(s\) of 0\.00 vs printed 3/.test(count[2]), 'the bank counts its 0.00 line');
  assert.ok(check(s, 'Lines of 0.00 left out')[1]);
  assert.ok(s.ok);
  assert.equal(statusOf(s), 'green');
  const [out] = expressFiles(groupBatch([s]));
  assert.equal(out.fileName, 'SCBBIZ_0000_202606-202606_BKTRN.xlsx');
  const remark = i => { const c = out.sheets[0].rows[i + 3][5]; return c?.value ?? c; };
  assert.equal(remark(0), 'DCP 999 MADE-UP CO.,L');
  assert.equal(remark(1), 'เช็คเรียกเก็บอัตโนมัติ 00012345', 'the cheque number in the remark');
});

const KBIZ_LINES = [
  [41, 62, th('รายการเดินบัญชีเงินฝากกระแสรายวัน', 20)],
  [378, 140, th('เลขที่บัญชีเงินฝาก', 12)], [445, 140, '999-9-99999-9'],
  [150, 175, th('รายการ', 6)], [291, 175, th('ถอนเงิน/ฝากเงิน', 10)],
  [41, 206, th('01-มิ.ย.-2569', 9)], [90, 206, th('ยอดยกมา', 6)], [389, 206, '-2,000.00'],
  [41, 224, th('01-มิ.ย.-2569', 9)], [90, 224, th('รับโอนเงิน', 7)], [336, 224, '500.00'], [389, 224, '-1,500.00'], [452, 224, '0898 ACP00001 124608'],
  [41, 242, th('02-มิ.ย.-2569', 9)], [90, 242, th('ค่าธรรมเนียม', 7)], [322, 242, '8.00'], [389, 242, '-1,508.00'],
  [41, 260, th('02-มิ.ย.-2569', 9)], [90, 260, th('ฝากด้วยเช็ค', 7)], [237, 260, '01234567'], [325, 260, '2,000.00'], [405, 260, '492.00'],
  [90, 290, th('ยอดยกไป', 6)], [405, 290, '492.00'],
  [90, 310, th('รวมรายการด้านการถอนเงิน', 15)], [171, 310, '='], [199, 310, '1'], [211, 310, th('รายการ', 4)], [318, 310, '8.00'],
  [90, 320, th('รวมรายการด้านการฝากเงิน', 15)], [171, 320, '='], [199, 320, '2'], [211, 320, th('รายการ', 4)], [320, 320, '2,500.00'],
  [381, 760, 'K-BIZ Contact Center'],
];

test('KBank K-BIZ: told from the personal KBank form, Thai-month dates, one amount column, no period printed', async () => {
  const s = await read(KBIZ_LINES);
  assert.equal(s.profile.key, 'kbiz', 'not the personal KBank form, whose footer it shares');
  assert.equal(identify('K-BIZ Contact Center').key, 'kbank', 'the personal form is still found by its footer');
  assert.deepEqual(s.rows.map(r => r.date), ['2026-06-01', '2026-06-02', '2026-06-02']);
  assert.deepEqual(s.rows.map(r => [r.withdrawal, r.deposit]), [[null, 50000], [800, null], [null, 200000]]);
  assert.equal(s.rows[2].details, '01234567');
  assert.deepEqual([s.facts.period_from, s.facts.period_to], ['01/06/2026', '02/06/2026']);
  assert.ok(check(s, 'Statement period not printed')[1]);
  assert.equal(s.facts.closing_stated, 49200);
  assert.deepEqual([s.facts.withdraw_count, s.facts.deposit_count], [1, 2]);
  assert.equal(statusOf(s), 'green');
});

test('ttb business one: dotted dates, the channel said twice, totals and closing on the last lines', async () => {
  const s = await read([
    [336, 36, th('รายการเคลื่อนไหวทางบัญชี', 20)],
    [178, 83, th('เลขที่บัญชี:', 10)], [178, 98, '999 9 99999 9'],
    [178, 125, th('วันที่ออกใบแจ้งรายการ:', 20)], [178, 140, '0999'], [309, 140, '01.06.2026 - 30.06.2026'],
    [415, 290, th('ยอดคงเหลือยกมา', 12)], [516, 290, '1,000.00'],
    [30, 308, '01.06.2026'], [82, 308, '12:49:29'], [124, 308, 'KBANK'], [150, 308, 'Transfer in via KBANK X0000 ACME'],
    [441, 308, '2,000.00'], [516, 308, '3,000.00'],
    [30, 338, '01.06.2026'], [82, 338, '12:50:26'], [124, 338, 'business one'], [192, 338, 'Bill payment via business one'],
    [373, 338, '500.00'], [516, 338, '2,500.00'],
    [192, 350, 'MADE-UP CREDIT BANK'],
    [403, 713, th('ยอดเงินคงเหลือยกไป', 14)], [516, 713, '2,500.00'],
    [30, 740, th('ยอดรวมเงินถอนจากบัญชี:', 18)], [200, 740, '1'], [250, 740, '500.00'],
    [30, 752, th('ยอดรวมเงินฝากเข้าบัญชี:', 18)], [200, 752, '1'], [250, 752, '2,000.00'],
    [30, 770, th('เงินคงเหลือบัญชี ณ วันที่', 18)], [200, 770, '30.06.2026'],
    [30, 785, '2,500.00'],
  ]);
  assert.equal(s.profile.key, 'ttbbiz');
  assert.equal(s.facts.account_no, '999-9-99999-9');
  assert.deepEqual([s.facts.period_from, s.facts.period_to], ['01/06/2026', '30/06/2026']);
  assert.deepEqual(s.rows.map(r => [r.date, r.time]), [['2026-06-01', '12:49:29'], ['2026-06-01', '12:50:26']]);
  assert.deepEqual(s.rows.map(r => r.channel), ['KBANK', 'business one']);
  assert.equal(s.rows[0].description, 'Transfer in via KBANK X0000 ACME');
  assert.equal(s.rows[1].description, 'Bill payment via business one MADE-UP CREDIT BANK');
  assert.equal(s.facts.closing_stated, 250000);
  assert.deepEqual([s.facts.withdraw_count, s.facts.withdraw_total, s.facts.deposit_count, s.facts.deposit_total], [1, 50000, 1, 200000]);
  assert.equal(statusOf(s), 'green');
});

test('UOB Business: deposits left of withdrawals, the STATEMENT date, never the print-date ledger balance', async () => {
  const s = await read([
    [40, 198, 'Account Details'],
    [304, 229, 'Account Number:'], [409, 229, '9999999999'],
    [304, 238, 'Ledger Balance:'], [409, 238, '9,999.99'],
    [40, 321, 'Movement Details - From: 01 Jun 2026 To: 30 Jun 2026'],
    [40, 352, 'Statement'], [93, 352, 'Value'], [198, 352, 'Description'], [304, 352, 'Deposit'], [383, 352, 'Withdrawal'], [462, 352, 'Balance'],
    [41, 372, '02/06/2026'], [94, 372, '30/05/2026'], [147, 372, '30/05/2026'], [199, 372, 'TRF DEP SATM'],
    [305, 372, '500.00'], [384, 372, '0.00'], [463, 372, '1,500.00'],
    [140, 381.7, '06:58:53 PM'], [199, 381.7, 'REF0001'],
    [41, 393, '02/06/2026'], [94, 393, '30/05/2026'], [147, 393, '30/05/2026'], [199, 393, 'CASH'],
    [305, 393, '0.00'], [384, 393, '200.00'], [463, 393, '1,300.00'],
    [41, 728, 'Total in Account Currency 500.00 200.00'],
  ]);
  assert.equal(s.profile.key, 'uobbiz');
  assert.deepEqual(s.rows.map(r => r.date), ['2026-06-02', '2026-06-02'], 'the statement date (Co 2026-10-16), not the value date 30/05');
  assert.deepEqual(s.rows.map(r => [r.withdrawal, r.deposit]), [[null, 50000], [20000, null]]);
  assert.ok(s.rows.every(r => r.notes.length === 0), 'no "printed in the other column" warning: deposits sit left here');
  assert.equal(s.rows[0].time, '06:58:53');
  assert.equal(s.rows[0].description, 'TRF DEP SATM REF0001');
  assert.equal(s.opening, 100000, 'worked back from the first line');
  assert.equal(s.facts.closing_stated, null, 'the Ledger Balance is the print-date balance');
  assert.deepEqual([s.facts.deposit_total, s.facts.withdraw_total], [50000, 20000]);
  assert.equal(statusOf(s), 'green');
});

test('EXIM Bank: told by its address, codes named by the printed legend, totals on one line', async () => {
  const s = await read([
    [64, 55, th('อาคารเอ็กซิม', 8)],
    [20, 108, th('เลขที่บัญชี', 6)], [49, 108, ':'], [55, 108, '999-9-99999-9'],
    [26, 197, '01-06-2026'], [86, 197, th('ยอดยกมา', 6)], [546, 197, '1,000.00'],
    [26, 211, '30-06-2026'], [95, 211, 'INP'], [133, 211, 'REF/26'], [320, 211, '400.00'], [555, 211, '600.00'],
    [26, 226, '30-06-2026'], [92, 226, 'BPKB'], [437, 226, '250.00'], [555, 226, '850.00'],
    [87, 696, th('ยอดยกไป', 6)], [546, 696, '850.00'],
    [67, 726, 'TOTAL DR 1 400.00 THB TOTAL CR 1 250.00 THB'],
    [21, 760, 'BPKB - DEPOSIT THRU BILLS PAYMENT-KBANK INP - INTEREST PACKING CREDIT'],
  ]);
  assert.equal(s.profile.key, 'exim');
  assert.deepEqual(s.rows.map(r => [r.withdrawal, r.deposit]), [[40000, null], [null, 25000]]);
  assert.equal(s.rows[0].details, 'REF/26');
  assert.equal(s.rows[1].details, 'DEPOSIT THRU BILLS PAYMENT-KBANK', 'the code named by the legend');
  assert.deepEqual([s.facts.period_from, s.facts.period_to], ['30/06/2026', '30/06/2026']);
  assert.equal(statusOf(s), 'green');
});

test('Account Activity History Report: the other party on the lines below, labels dropped, opening worked back', async () => {
  const s = await read([
    [201, 36, 'ACCOUNT ACTIVITY HISTORY REPORT'],
    [241, 51, 'From: 01/06/2026 To: 30/06/2026'],
    [48, 78, 'Account Number : 9999999999'],
    [139, 110, 'Description'], [296, 110, 'Debit'], [352, 110, 'Credit'], [414, 110, 'Balance'],
    [23, 134, '26/06/2026'], [60, 134, '26/06/2026'], [95, 134, 'TRF FR OTH BK AC'], [224, 134, 'TRF'], [245, 134, '00000000'],
    [360, 134, '300.00'], [420, 134, '1,300.00'], [463, 134, 'mPhone'],
    [95, 144, 'Bank/Branch: MADE-UP'], [95, 155, 'Account Number: 999XXX999'], [95, 165, 'Account Name: ACME CO'], [95, 175, 'Reference:'],
    [300, 192, 'Total Debit : 0.00'], [300, 212, 'Total Credit : 300.00'],
  ]);
  assert.equal(s.profile.key, 'bblact');
  assert.equal(s.facts.account_no, '9999999999');
  assert.equal(s.rows[0].description, 'TRF FR OTH BK AC MADE-UP 999XXX999 ACME CO');
  assert.equal(s.rows[0].deposit, 30000);
  assert.equal(s.opening, 100000);
  assert.equal(statusOf(s), 'green');
});

test('every business form writes the Express template: its six field codes on row 3', async () => {
  const s = await read(KBIZ_LINES);
  const [out] = expressFiles(groupBatch([s]));
  assert.deepEqual(out.sheets[0].rows[2].slice(0, 6).map(c => c.value ?? c), BKTRN_FIELDS);
  assert.equal(out.fileName, 'KBIZ_9999_202606-202606_BKTRN.xlsx');
});
