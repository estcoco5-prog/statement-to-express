// BBL Transaction Report (Co 2026-10-13): Bangkok Bank's business internet
// banking report - newest line first, no brought-forward line, no totals,
// debits printed with a minus, a masked account number, and a print-date
// balance at the top that is never the closing. Made-up figures, at the x
// positions measured off a real report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pdfjs from './pdfjs.js';
import { miniPdf } from './minipdf.js';
import { readStatement, statusOf } from '../src/engine/statement.js';
import { groupBatch } from '../src/engine/batch.js';
import { expressFiles, expressMonthFiles, BKTRN_LABELS, BKTRN_LIMITS, BKTRN_FIELDS } from '../src/engine/output/express.js';

// one line: [date, time, description, debit, credit, balance]
function report(lines, { period = ['01/01/2025', '31/03/2025'], account = '9990xxx123' } = {}) {
  const text = [
    [900, 42, 'Transaction Report'],
    [870, 58, `(Period from ${period[0]} to ${period[1]})`],
    [38, 91, 'Customer'], [148, 91, 'MADE-UP TRADING'],
    [38, 109, 'Account Name'], [148, 109, 'MADE-UP TRADING CO.,LTD'],
    [38, 127, 'Account Number'], [141, 127, ':'], [148, 127, account],
    [312, 127, 'Source Of Account'], [413, 127, ':'], [420, 127, 'Internal'],
    [650, 127, 'Ledger Balance'], [752, 127, ':'], [800, 127, '999,999.99'],   // the PRINT-date balance
    [168, 188, 'Value'],
    [38, 193, 'Transaction Date And Time'], [240, 193, 'Description'], [398, 193, 'ChequeNo.'],
    [492, 193, 'Debit'], [585, 193, 'Credit'], [671, 193, 'Ledger Balance'], [758, 193, 'Channel'], [853, 193, 'Branch'],
    [168, 200, 'Date'],
  ];
  lines.forEach(([date, time, desc, debit, credit, balance], i) => {
    const y = 214 + i * 14;
    text.push([38, y, date], [77, y, time], [171, y, date], [238, y, desc],
      [520, y, debit], [620, y, credit], [705, y, balance], [758, y, 'Automatic'], [853, y, 'HEAD OFFICE']);
  });
  text.push([839, 790, 'Bangkok Bank Public Company Limited'], [38, 798, 'Created by'], [38, 812, 'Printed on'],
    [38, 826, 'Page no'], [123, 826, 'Page 1 of 1']);
  return miniPdf(text, { width: 1051 });
}

const FEB_MAR = [
  ['20/03/2025', '18:43:15', 'TRF FR OTH BK', '0.00', '300.00', '1,450.00'],
  ['15/03/2025', '15:31:05', 'PAYMENT ON GOODS', '-1,000.00', '0.00', '1,150.00'],
  ['02/02/2025', '06:01:25', 'BBL.CARD', '0.00', '150.00', '2,150.00'],
  ['01/02/2025', '03:11:22', 'BBL.CARD', '0.00', '500.00', '2,000.00'],
];

test('the report is read: its own form, oldest first, opening worked back, every line proved', async () => {
  const s = await readStatement('report.pdf', report(FEB_MAR), [], null, pdfjs);
  assert.equal(s.profile.key, 'bblreport', 'not taken for the BBL statement');
  assert.deepEqual(s.rows.map(r => r.date), ['2025-02-01', '2025-02-02', '2025-03-15', '2025-03-20']);
  assert.equal(s.opening, 150000);
  assert.equal(s.closing, 145000, 'the newest line, never the print-date balance');
  assert.equal(s.facts.closing_stated, null);
  assert.equal(s.rows[2].withdrawal, 100000, 'the minus debit is a withdrawal');
  assert.equal(s.rows[0].time, '03:11:22');
  assert.ok(s.rows.every(r => r.verified));
  assert.equal(s.facts.account_no, '9990xxx123', 'a masked number with 7 digits showing is the account');
  assert.equal(statusOf(s), 'yellow', 'nothing printed confirms it: at most yellow');
  const empty = s.checks.find(([label]) => label.startsWith('A month or more of the statement period has no lines'));
  assert.ok(empty && empty[1] && /no lines 2025-01-01 to 2025-01-31/.test(empty[2]), 'an empty January is said, never refused');
  const [out] = expressFiles(groupBatch([s]));
  assert.equal(out.fileName, 'BBLREPORT_x123_202501-202503_BKTRN.xlsx');
  assert.equal(out.n, 4);
});

test('a report whose dates do not all run newest-first is refused, not guessed at', async () => {
  const mixed = [FEB_MAR[3], FEB_MAR[0]];
  await assert.rejects(readStatement('mixed.pdf', report(mixed), [], null, pdfjs), /newest line first/);
});

test('long and monthly: a two-month report and the next month\'s report link into one file', async () => {
  const long = await readStatement('feb-mar.pdf', report(FEB_MAR), [], null, pdfjs);
  const april = await readStatement('apr.pdf', report([
    ['10/04/2025', '09:00:00', 'BBL.CARD', '0.00', '50.00', '1,500.00'],
  ], { period: ['01/04/2025', '30/04/2025'] }), [], null, pdfjs);
  const groups = groupBatch([april, long]);
  assert.equal(groups.length, 1, 'the same masked account: one group');
  const [g] = groups;
  const link = g.checks.find(([label]) => label === 'Each closing balance is the next opening balance');
  assert.ok(link[1], link[2]);
  assert.equal(g.status(long), 'green', 'confirmed by the next month');
  const [out] = expressFiles(groups);
  assert.equal(out.n, 5);
  assert.equal(out.fileName, 'BBLREPORT_x123_202501-202504_BKTRN.xlsx');
});

test('a month that is in both a long report and a monthly one goes in once', async () => {
  const long = await readStatement('feb-mar.pdf', report(FEB_MAR), [], null, pdfjs);
  const march = await readStatement('mar.pdf', report(FEB_MAR.slice(0, 2), { period: ['01/03/2025', '31/03/2025'] }), [], null, pdfjs);
  const [g] = groupBatch([long, march]);
  assert.ok(g.leftOutReason(march) || g.leftOutReason(long), 'one of the two is left out');
  assert.equal(g.expressRows().length, 4, 'no line imported twice');
});

test('a short mask never groups two files: it could be two accounts', async () => {
  const a = await readStatement('a.pdf', report(FEB_MAR, { account: 'xxx-x-x0000-x' }), [], null, pdfjs);
  const b = await readStatement('b.pdf', report(FEB_MAR, { account: 'xxx-x-x0000-x' }), [], null, pdfjs);
  assert.equal(a.facts.account_no, null);
  assert.equal(groupBatch([a, b]).length, 2);
});

test('one Express file per month: the same rows, split by month, each a proper import file', async () => {
  const s = await readStatement('report.pdf', report(FEB_MAR), [], null, pdfjs);
  const [g] = groupBatch([s]);
  const months = expressMonthFiles(g);
  assert.deepEqual(months.map(m => [m.month, m.n, m.fileName]), [
    ['2025-02', 2, 'BBLREPORT_x123_202502_BKTRN.xlsx'],
    ['2025-03', 2, 'BBLREPORT_x123_202503_BKTRN.xlsx'],
  ]);
  const [whole] = expressFiles([g]);
  assert.equal(months.reduce((a, m) => a + m.wd, 0), whole.wd);
  assert.equal(months.reduce((a, m) => a + m.dep, 0), whole.dep);
  for (const m of months) {
    const [bktrn] = m.sheets;
    assert.equal(bktrn.name, 'BKTRN');
    assert.deepEqual(bktrn.rows[0].slice(0, 6).map(c => c.value), BKTRN_LABELS);
    assert.deepEqual(bktrn.rows[1].slice(0, 6).map(c => c.value), BKTRN_LIMITS);
    assert.deepEqual(bktrn.rows[2].slice(0, 6).map(c => c.value), BKTRN_FIELDS);
    assert.equal(bktrn.rows.length - 3, m.n);
    const proof = m.sheets.find(sh => sh.name === 'Proof');
    assert.ok(proof.rows.some(r => r[0]?.value === 'Month in this file' && r[2]?.value === m.month));
  }
});
