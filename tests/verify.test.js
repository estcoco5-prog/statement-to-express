import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChecks } from '../src/engine/verify.js';
import { Row, flagFurniture } from '../src/engine/extract.js';
import { setToday } from '../src/engine/dates.js';
import { PROFILES } from '../src/engine/profiles.js';
import { word } from './helpers.js';
import { txLine, headerLines, openingLine, uobLine, uobPage, ktbLine, ktbPage } from './fixtures.js';
import { run, byLabel, allPass } from './pipeline.js';

const { kbank: KBANK, uob: UOB, ktb: KTB } = PROFILES;
const clean = () => [...headerLines(), ...openingLine(193),
  ...txLine(205, { date: '09-06-26', time: '13:39', desc: 'โอนเงิน', withdraw: '10,000.00',
    balance: '21,234.56', channel: 'K PLUS', details: 'โอนไป X0000' }),
  ...txLine(217, { date: '19-06-26', time: '23:59', desc: 'รับดอกเบี้ยเงินฝาก', deposit: '65.43',
    balance: '21,299.99', channel: 'โอนเข้า' })];

// Port of test_clean_statement
test('a clean statement verifies end to end', () => {
  const { opening, rows, closing, checks } = run([clean()]);
  assert.equal(opening, 3123456);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].withdrawal, 1000000); assert.equal(rows[0].deposit, null);
  assert.equal(rows[1].deposit, 6543); assert.equal(rows[1].withdrawal, null);
  assert.equal(closing, 2129999);
  assert.ok(allPass(checks), JSON.stringify(checks));
  assert.ok(rows.every(r => r.ok));
});

test('check labels and details are word-for-word the answer key', () => {
  const { checks } = run([clean()]);
  assert.deepEqual(checks, [
    ['Every row agrees with the running balance', true, '2 of 2 rows verified'],
    ['Dates never go backwards', true, 'in order'],
    ['Final balance matches the closing balance the bank printed', true, 'computed 21299.99 vs printed 21299.99'],
    ["Total withdrawals matches the bank's own total", true, 'computed 10000.00 vs printed 10000.00'],
    ["Number of withdrawals matches the bank's own count", true, 'found 1 vs printed 1'],
    ["Total deposits matches the bank's own total", true, 'computed 65.43 vs printed 65.43'],
    ["Number of deposits matches the bank's own count", true, 'found 1 vs printed 1'],
    ['No other anomalies on any row', true, 'clean'],
  ]);
});

// Port of test_broken_chain_is_flagged_not_dropped
test('a row that breaks the balance chain is flagged, and still kept', () => {
  const page = [...headerLines(), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '29,999.99' }),
    ...txLine(217, { date: '19-06-26', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '30,065.42' })];
  const { rows, checks } = run([page]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].notes[0],
    'balance chain broken: 31234.56 -> 29999.99 is a change of -1234.57, but the amount printed is 10000.00');
  assert.equal(byLabel(checks)['Every row agrees with the running balance'][0], false);
  assert.equal(rows[1].deposit, 6543);
});

// Port of test_zero_delta_row_cannot_be_classified
test('a row where the balance does not move is refused, not guessed at', () => {
  const page = [...headerLines({ closing: '31,234.56', wTotal: '0.00', wCount: 0, dTotal: '0.00', dCount: 0 }),
    ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'รายการ', withdraw: '500.00', balance: '31,234.56' })];
  const { rows, checks } = run([page]);
  assert.equal(rows[0].withdrawal, null); assert.equal(rows[0].deposit, null);
  assert.equal(rows[0].verified, false);
  assert.equal(byLabel(checks)['Every row agrees with the running balance'][0], false);
});

// Port of test_balance_beats_column_position
test('when the column disagrees with the balance, the balance wins', () => {
  const page = [...headerLines({ closing: '36,234.56', wTotal: '0.00', wCount: 0, dTotal: '5,000.00', dCount: 1 }),
    ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'รับโอน', withdraw: '5,000.00', balance: '36,234.56' })];
  const { rows, closing } = run([page]);
  assert.equal(rows[0].deposit, 500000); assert.equal(rows[0].withdrawal, null);
  assert.ok(rows[0].notes.some(n => n.includes('printed in the')), rows[0].notes.join());
  assert.equal(closing, 3623456);
});

// Port of test_buddhist_era_dates
test('Buddhist Era dates are converted, anchored to the stated period', () => {
  const page = [...headerLines({ periodFrom: '01/06/2569', periodTo: '30/06/2569' }),
    ...openingLine(193, '31,234.56', '01-06-69'),
    ...txLine(205, { date: '09-06-69', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' }),
    ...txLine(217, { date: '19-06-69', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '21,299.99' })];
  const { rows } = run([page]);
  assert.equal(rows[0].date, '2026-06-09');
  assert.ok(rows.every(r => r.ok));
});

// Port of test_multi_page / test_margin_stamp / test_carry_forward (proof halves)
test('the chain runs across pages, past a margin stamp and a carry-forward', () => {
  const page1 = [...headerLines({ wTotal: '10,001.00', wCount: 2 }), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' }),
    word('KBPDF', 52.0, 739.0),
    ...txLine(738.6, { date: '10-06-26', desc: 'ชำระเงิน', withdraw: '1.00', balance: '21,233.56' })];
  const page2 = [...openingLine(193, '21,233.56', '19-06-26'),
    ...txLine(205, { date: '19-06-26', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '21,298.99' })];
  const { rows, closing, checks } = run([page1, page2]);
  assert.equal(rows.length, 3);
  assert.equal(closing, 2129899);
  assert.equal(byLabel(checks)['Final balance matches the closing balance the bank printed'][0], false); // header says 21,299.99
  assert.equal(byLabel(checks)['Every row agrees with the running balance'][0], true);
});

// Port of test_totals_mismatch_detected
test('a transaction missing from the page fails the bank\'s own totals', () => {
  const page = [...headerLines({ wTotal: '15,000.00', wCount: 2, dTotal: '0.00', dCount: 0, closing: '21,234.56' }),
    ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' })];
  const c = byLabel(run([page]).checks);
  assert.equal(c["Total withdrawals matches the bank's own total"][0], false);
  assert.equal(c["Number of withdrawals matches the bank's own count"][0], false);
  assert.deepEqual(c["Total deposits matches the bank's own total"], [true, 'computed 0 vs printed 0.00']);
});

// Port of test_leaked_furniture_is_flagged_not_silent
test('furniture inside a row fails a check instead of passing quietly', () => {
  const page = [...headerLines({ dTotal: '0.00', dCount: 0, closing: '21,234.56' }), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' })];
  const { facts, opening, rows, closing, checks } = run([page]);
  assert.equal(byLabel(checks)['No other anomalies on any row'][0], true);
  rows[0].details += ' หน้าที่ (PAGE/OF) 7/13 987-6-54321-0';
  rows[0].notes.length = 0;
  flagFurniture(rows[0], KBANK);
  const after = byLabel(buildChecks(opening, rows, closing, facts));
  assert.equal(after['No other anomalies on any row'][0], false);
  assert.equal(after['Every row agrees with the running balance'][0], true);
});

// Port of test_uob_group_balance_proves_rows_without_one
test('UOB: rows that print no balance are proved as a group', () => {
  const page = uobPage([
    uobLine(100, '01 Sep', 'BALANCE B/F', { balance: '20,111.11' }),
    uobLine(120, '29 Sep', 'TRF DEP SATM', { deposit: '4,321.00' }),
    uobLine(130, '29 Sep', 'CC/LN PAYMENT EPY', { withdraw: '9,876.54' }),
    uobLine(140, '29 Sep', 'TRF DEP SATM', { deposit: '11,000.00' }),
    uobLine(150, '29 Sep', 'CC/LN PAYMENT EPY', { withdraw: '432.10', balance: '25,123.47' }),
    uobLine(160, '01 Oct', 'INTEREST CREDIT', { deposit: '1.02', balance: '25,124.49' }),
    [word('Total', 105.5, 180), word('10,308.64', 381.0 - 26.1, 180, 26.1),
      word('15,322.02', 457.7 - 26.1, 180, 26.1), word('25,124.49', 546.2 - 26.1, 180, 26.1)],
  ]);
  const { facts, rows, closing, checks } = run([page], UOB);
  assert.equal(rows.length, 5);
  assert.ok(rows.every(r => r.verified), JSON.stringify(rows.map(r => r.notes)));
  assert.deepEqual(rows.map(r => r.deposit !== null), [true, false, true, false, true]);
  assert.equal(closing, 2512449);
  assert.deepEqual([facts.withdraw_total, facts.deposit_total, facts.closing_stated], [1030864, 1532202, 2512449]);
  assert.equal(rows[0].date, '2026-09-29');
  assert.equal(rows[4].date, '2026-10-01');
  const outside = byLabel(checks)['Rows dated outside the statement period (allowed, listed)'];
  assert.deepEqual(outside, [true, '2026-10-01 1.02']);
  assert.ok(allPass(checks), JSON.stringify(checks.filter(c => !c[1])));
});

// Port of test_uob_group_that_does_not_add_up_is_flagged
test('UOB: a group that misses its printed balance flags every row in it', () => {
  const page = uobPage([
    uobLine(100, '01 Sep', 'BALANCE B/F', { balance: '20,111.11' }),
    uobLine(120, '29 Sep', 'TRF DEP SATM', { deposit: '4,321.00' }),
    uobLine(130, '29 Sep', 'CC/LN PAYMENT EPY', { withdraw: '432.10', balance: '24,000.00' }),
    uobLine(140, '30 Sep', 'TRF DEP SATM', { deposit: '5.00' }),
  ]);
  const { rows, checks } = run([page], UOB);
  assert.equal(rows.length, 3);
  assert.ok(rows.slice(0, 2).every(r => !r.verified && r.notes.length));
  assert.equal(rows[0].notes[0], 'these 2 rows share one printed balance, and they do not add up to it: ' +
    '20111.11 -> 24000.00 is a change of 3888.89, the rows net 3888.90');
  assert.ok(rows[2].notes[0].includes('no balance was printed'));
  assert.equal(byLabel(checks)['Every row agrees with the running balance'][0], false);
});

// Port of test_ktb_buddhist_two_digit_years_and_derived_opening (proof half)
test('KTB: derived opening confirmed by the printed totals', () => {
  setToday(() => '2026-10-01');
  const page = ktbPage([
    ktbLine(100, '10/10/68', 'เงินโอนเข้า', '000-1112223334', { deposit: '2,000.00', balance: '26,111.22', time: '08:35' }),
    ktbLine(125, '17/10/68', 'จ่ายค่าสินค้า/บริการ', 'KTC-0000', { withdraw: '5,800.00', balance: '20,311.22', time: '14:51' }),
    ktbLine(150, '31/12/68', 'ดอกเบี้ยและภาษี', null, { withdraw: '0.00', deposit: '5.09', balance: '20,316.31', time: '01:40' }),
    [word('รายการถอนทั้งหมด', 39.7, 200), word('1', 102.0, 200, 3.7), word('5,800.00', 158.7, 200)],
    [word('รายการฝากทั้งหมด', 39.7, 215), word('2', 102.0, 215, 3.7), word('2,005.09', 158.7, 215)],
  ]);
  const { rows, checks } = run([page], KTB);
  setToday(null);
  assert.equal(rows[2].deposit, 509);
  assert.ok(allPass(checks), JSON.stringify(checks.filter(c => !c[1])));
  assert.deepEqual(byLabel(checks)['Opening balance (not printed by the bank) worked back from row 1'],
    [true, '24111.22; confirmed only through the totals checks above']);
});

const rowOf = (date, withdrawal, balance) => {
  const r = new Row();
  r.date = date; r.description = 'x'; r.withdrawal = withdrawal; r.amount = withdrawal;
  r.balance = balance; r.verified = true;
  return r;
};

// Port of test_dates_that_go_backwards_fail
test('a date that goes backwards fails the statement', () => {
  const facts = { period_from: '01/07/2026', period_to: '31/07/2026', closing_stated: null,
    withdraw_total: null, withdraw_count: null, deposit_total: null, deposit_count: null };
  const rows = [rowOf('2026-07-24', 1000, 9000), rowOf('2026-07-20', 1000, 8000), rowOf('2026-07-29', 1000, 7000)];
  const got = byLabel(buildChecks(10000, rows, 7000, facts))['Dates never go backwards'];
  assert.deepEqual(got, [false, '2026-07-20 comes after 2026-07-24']);
  rows[1].date = '2026-07-29';
  assert.equal(byLabel(buildChecks(10000, rows, 7000, facts))['Dates never go backwards'][0], true);
});

test('an empty side prints its total as 0, like Python', () => {
  const facts = { closing_stated: null, withdraw_total: 0, withdraw_count: null,
    deposit_total: null, deposit_count: null, period_from: null, period_to: null };
  const t = buildChecks(0, [], 0, facts).find(c => c[0] === "Total withdrawals matches the bank's own total");
  assert.deepEqual(t, ["Total withdrawals matches the bank's own total", true, 'computed 0 vs printed 0.00']);
});

test('a dated row with a warning is reported as an anomaly', () => {
  const r = rowOf('2026-07-24', 1000, 9000);
  r.notes.push('something');
  const facts = { closing_stated: null, withdraw_total: null, withdraw_count: null,
    deposit_total: null, deposit_count: null, period_from: null, period_to: null };
  assert.deepEqual(byLabel(buildChecks(10000, [r], 9000, facts))['No other anomalies on any row'],
    [false, '1 row(s) carry a warning']);
});

// Co 2026-10-02: interest booked gross, the bank's withholding tax as its own
// withdrawal row. Made-up figures, satang.
import { classifyAndVerify, TAX_LABEL } from '../src/engine/verify.js';

test('tax withheld from interest becomes its own withdrawal row', () => {
  const pay = new Row();
  pay.date = '2026-06-30'; pay.amount = 1000; pay.amountX1 = 400; pay.balance = 30000;
  const interest = new Row();
  interest.date = '2026-06-30'; interest.amount = 3968; interest.tax = 40;
  interest.amountX1 = 613; interest.balance = 30000 + 3928;            // the balance moves by the net
  const rows = [pay, interest];
  const closing = classifyAndVerify(31000, rows, { amountSplitX: 560 });
  assert.equal(closing, 33928);
  assert.equal(rows.length, 3);
  const [, gross, tax] = rows;
  assert.deepEqual([gross.deposit, gross.balance, gross.verified], [3968, 33968, true]);
  assert.deepEqual([tax.withdrawal, tax.balance, tax.isTax, tax.details], [40, 33928, true, TAX_LABEL]);
  // The bank's printed withdrawal total leaves its tax out.
  const facts = { closing_stated: 33928, withdraw_total: 1000, withdraw_count: null,
    deposit_total: 3968, deposit_count: null, period_from: null, period_to: null };
  const checks = byLabel(buildChecks(31000, rows, closing, facts));
  assert.equal(checks["Total withdrawals matches the bank's own total"][0], true);
  assert.deepEqual(checks['Tax the bank withheld, written as its own withdrawal rows'], [true, '1 row(s), total 0.40']);
});

test('a tax row the balance does not confirm is flagged, not split', () => {
  const r = new Row();
  r.date = '2026-06-30'; r.amount = 3968; r.tax = 40; r.balance = 31000 + 3968;   // tax not taken: chain broken
  const rows = [r];
  classifyAndVerify(31000, rows, { amountSplitX: null });
  assert.equal(rows.length, 1);
  assert.equal(r.verified, false);
  assert.match(r.notes[0], /tax 0\.40/);
});
