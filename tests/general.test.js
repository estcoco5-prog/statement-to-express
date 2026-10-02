// The general reader - a bank with no profile yet. Port of the answer key's
// general-reader tests; every figure is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { word, rightAligned } from './helpers.js';
import { txLine, headerLines, openingLine } from './fixtures.js';
import { run, allPass } from './pipeline.js';
import { PROFILES } from '../src/engine/profiles.js';
import { generalProfile, UNTESTED_CAVEAT } from '../src/engine/general.js';
import { Statement, statusOf, readStatement } from '../src/engine/statement.js';
import { Row } from '../src/engine/extract.js';
import { groupBatch } from '../src/engine/batch.js';
import { expressFiles, remarkFor } from '../src/engine/output/express.js';
import { buildWorkbook } from '../src/engine/output/review.js';
import { miniPdf } from './minipdf.js';
import pdfjs from './pdfjs.js';

const kbankShaped = () => [
  ...headerLines(), word('วันที่', 74.5, 180.5), word('ยอดคงเหลือ', 285.9, 174.7),
  ...openingLine(193),
  ...txLine(205, { date: '09-06-26', time: '13:39', desc: 'โอนเงิน', withdraw: '10,000.00',
    balance: '21,234.56', channel: 'K PLUS', details: 'โอนไป X0000' }),
  ...txLine(217, { date: '19-06-26', time: '23:59', desc: 'รับดอกเบี้ยเงินฝาก', deposit: '65.43',
    balance: '21,299.99', channel: 'โอนเข้า' }),
];

function scbLine(y, { date, time, channel, debit, credit, balance, desc } = {}) {
  const w = [];
  if (date) w.push(word(date, 30.0, y, 28.0));
  if (time) w.push(word(time, 63.5, y, 18.0));
  if (channel) w.push(word(channel, 125.1, y));
  if (debit) w.push(rightAligned(debit, 228.0, y));
  if (credit) w.push(rightAligned(credit, 302.0, y));
  if (balance) w.push(rightAligned(balance, 392.0, y));
  if (desc) w.push(word(desc, 394.0, y));
  return w;
}

const scbShaped = () => [
  word('วันที่', 30.0, 90.0), word('01/12/2025', 60.0, 90.0), word('-', 100.0, 90.0),
  word('31/12/2025', 110.0, 90.0), word('Date', 30.0, 150.0), word('Balance', 360.0, 150.0),
  ...scbLine(165, { date: '01/12/25', balance: '25,000.00', desc: 'BALANCE BROUGHT FORWARD' }),
  ...scbLine(177, { date: '02/12/25', time: '06:08', channel: 'ENET', debit: '2,468.00',
    balance: '22,532.00', desc: 'TRANSFER OUT' }),
  ...scbLine(189, { date: '05/12/25', time: '10:00', channel: 'ENET', credit: '3,000.00',
    balance: '25,532.00', desc: 'TRANSFER IN' }),
];

function bblLine(y, { date, desc, withdraw, deposit, balance, channel } = {}) {
  const w = [];
  if (date) w.push(word(date, 25.0, y, 28.0));
  if (desc) w.push(word(desc, 60.0, y));
  if (withdraw) w.push(rightAligned(withdraw, 310.0, y));
  if (deposit) w.push(rightAligned(deposit, 365.0, y));
  if (balance) w.push(rightAligned(balance, 425.0, y));
  if (channel) w.push(word(channel, 435.0, y));
  return w;
}

const bblShaped = () => [
  word('Statement', 25.0, 90.0), word('Period', 60.0, 90.0), word('01/09/2025', 90.0, 90.0),
  word('-', 130.0, 90.0), word('30/09/2025', 140.0, 90.0),
  word('Date', 25.0, 150.0), word('Balance', 395.0, 150.0),
  ...bblLine(165, { date: '01/09/25', desc: 'B/F', balance: '21,000.00' }),
  ...bblLine(177, { date: '03/09/25', desc: 'ATM', withdraw: '250.50', balance: '20,749.50', channel: 'ATM' }),
  ...bblLine(189, { date: '10/09/25', desc: 'SALARY', deposit: '1,200.00', balance: '21,949.50', channel: 'IB' }),
];

const moneyRows = rows => rows.map(r => [r.date, r.withdrawal, r.deposit, r.balance, r.verified]);

for (const [name, page, profile] of [['KBank', kbankShaped, PROFILES.kbank],
  ['SCB', scbShaped, PROFILES.scb], ['BBL', bblShaped, PROFILES.bbl]]) {
  test(`general reader gives the same rows as the ${name} profile`, () => {
    const general = generalProfile([page()]);
    assert.ok(general, 'a general profile is built');
    assert.equal(general.key, 'untested');
    assert.equal(general.untested, true);
    const p = run([page()], profile);
    const g = run([page()], general);
    assert.deepEqual([g.opening, g.closing], [p.opening, p.closing]);
    assert.deepEqual(moneyRows(g.rows), moneyRows(p.rows));
    assert.ok(allPass(g.checks), JSON.stringify(g.checks.filter(c => !c[1])));
  });
}

test('general reader refuses what it cannot read safely', () => {
  const noBalance = [...headerLines(), word('วันที่', 74.5, 180.5), word('ยอดคงเหลือ', 285.9, 174.7),
    ...openingLine(193),
    ...txLine(205, { date: '09-06-26', time: '13:39', desc: 'โอนเงิน', withdraw: '10,000.00' }),
    ...txLine(217, { date: '19-06-26', time: '23:59', desc: 'ดอกเบี้ย', deposit: '65.43' })];
  assert.equal(generalProfile([noBalance]), null, 'no balance column');
  assert.equal(generalProfile([kbankShaped().filter(w => w.text !== 'ยอดยกมา')]), null, 'no opening');
  assert.equal(generalProfile([kbankShaped().filter(w => !['วันที่', 'ยอดคงเหลือ'].includes(w.text))]),
    null, 'no column header');
});

test('general reader: the REMARK carries all the text, the time its own field', () => {
  const general = generalProfile([kbankShaped()]);
  const { rows } = run([kbankShaped()], general);
  assert.equal(rows[0].time, '13:39');
  assert.equal(remarkFor(rows[0], general.remarkFields), 'โอนเงิน K PLUS โอนไป X0000');
});

test('general reader: a wrap sits just below its row; text after a gap is not one', () => {
  const page = [...kbankShaped(), word('ต่อ', 404.0, 229.0),
    word('TOTAL', 123.0, 265.0), rightAligned('10,065.43', 267.0, 265.0),
    word('ออกโดย', 67.0, 290.0), word('777', 89.6, 290.0)];
  const general = generalProfile([page]);
  const { rows, checks } = run([page], general);
  const remark = remarkFor(rows.at(-1), general.remarkFields);
  assert.ok(remark.endsWith('ต่อ'), remark);
  assert.ok(!remark.includes('TOTAL') && !remark.includes('ออกโดย'), remark);
  assert.ok(allPass(checks));
});

test('general reader: a ruled line of dashes ends the table, even one row down', () => {
  const ruled = [...kbankShaped(), word('-', 123.0, 229.0), word('-', 140.0, 229.0),
    word('-', 404.0, 229.0), word('END', 240.0, 229.0), word('หมายเหตุ', 123.0, 241.0)];
  const general = generalProfile([ruled]);
  const { rows } = run([ruled], general);
  const remark = remarkFor(rows.at(-1), general.remarkFields);
  assert.ok(!remark.includes('-') && !remark.includes('หมายเหตุ'), remark);
});

function untestedStmt(from, to, opening, closing, account = '111-2-33333-4') {
  const general = generalProfile([kbankShaped()]);
  const facts = { account_no: account, account_name: null, branch: null, period_from: from,
    period_to: to, closing_stated: closing, withdraw_total: null, withdraw_count: null,
    deposit_total: null, deposit_count: null };
  const r = new Row();
  r.date = '2026-06-09'; r.description = 'TEST'; r.deposit = closing - opening;
  return new Statement(`untested-${from.slice(3, 5)}.pdf`, general, facts, opening, [r], closing,
    [['Every row agrees with the running balance', true, '']]);
}

test('an untested bank is never green, even anchored and linked by the next month', () => {
  const june = untestedStmt('01/06/2026', '30/06/2026', 10000, 20000);
  const july = untestedStmt('01/07/2026', '31/07/2026', 20000, 30000);
  assert.equal(statusOf(june), 'yellow');
  const [group] = groupBatch([june, july]);
  assert.ok(group.checks.every(([, ok]) => ok), JSON.stringify(group.checks));
  assert.equal(group.status(june), 'yellow');
});

test('untested bank is never green and is named in the file', () => {
  const s = untestedStmt('01/06/2026', '30/06/2026', 10000, 20000);
  assert.equal(statusOf(s), 'yellow');
  const [out] = expressFiles(groupBatch([s]));
  assert.match(out.fileName, /^UNTESTED_3334_202606-202606_BKTRN\.xlsx$/);
  const proof = out.sheets[2];
  assert.equal(proof.rows[0][0].value, UNTESTED_CAVEAT);
  const review = buildWorkbook(s.rows, s.opening, s.closing, s.facts, s.checks, s.profile, s.name);
  assert.equal(review[2].rows[0][0].value, UNTESTED_CAVEAT);
});

// Helvetica widths at 10pt, so numbers can be right-aligned in a real PDF.
const HELV = { '0': 5.56, '1': 5.56, '2': 5.56, '3': 5.56, '4': 5.56, '5': 5.56, '6': 5.56,
  '7': 5.56, '8': 5.56, '9': 5.56, ',': 2.78, '.': 2.78 };
const right = (x1, y, text) => [x1 - [...text].reduce((a, c) => a + HELV[c], 0), y, text];

test('readStatement falls back to the general reader for a bank it does not know', async () => {
  const pdf = miniPdf([
    [25, 90, 'Statement Period 01/09/2025 - 30/09/2025'],
    [25, 150, 'Date'], [395, 150, 'Balance'],
    [25, 165, '01/09/25'], [60, 165, 'B/F'], right(425, 165, '21,000.00'),
    [25, 177, '03/09/25'], [60, 177, 'ATM'], right(310, 177, '250.50'), right(425, 177, '20,749.50'),
    [25, 189, '10/09/25'], [60, 189, 'SALARY'], right(365, 189, '1,200.00'), right(425, 189, '21,949.50'),
  ]);
  const s = await readStatement('mystery.pdf', pdf, [], null, pdfjs);
  assert.equal(s.profile.key, 'untested');
  assert.equal(s.rows.length, 2);
  assert.ok(s.ok, JSON.stringify(s.checks.filter(c => !c[1])));
  assert.equal(statusOf(s), 'yellow');
  const forced = await readStatement('mystery.pdf', pdf, [], 'general', pdfjs);
  assert.equal(forced.profile.key, 'untested');
});
