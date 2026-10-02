import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDaily } from '../src/engine/daily.js';
import { txLine, headerLines, openingLine } from './fixtures.js';
import { run } from './pipeline.js';

const sum = (xs, k) => xs.reduce((s, x) => s + (x[k] ?? 0), 0);

// Port of test_daily_summary_ties_back_to_the_transactions
test('the Daily sheet groups by day and ties back to the rows', () => {
  const page = [...headerLines({ wTotal: '10,060.00', wCount: 2, closing: '21,239.99' }), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' }),
    ...txLine(217, { date: '09-06-26', desc: 'ชำระเงิน', withdraw: '60.00', balance: '21,174.56' }),
    ...txLine(229, { date: '10-06-26', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '21,239.99' })];
  const { opening, rows, closing } = run([page]);
  const days = buildDaily(rows, opening, '2026-06-09', '2026-06-10');
  assert.equal(days.length, 2);
  assert.equal(days[0].count, 2);
  assert.equal(days[0].withdrawn, 1006000);
  assert.equal(days[0].balance, 2117456);
  assert.equal(days[1].deposited, 6543);
  assert.equal(sum(days, 'withdrawn'), sum(rows, 'withdrawal'));
  assert.equal(sum(days, 'deposited'), sum(rows, 'deposit'));
  assert.equal(days[days.length - 1].balance, closing);
});

// Port of test_daily_summary_marks_a_flagged_day
test('a day containing a flagged row is marked, not silently averaged', () => {
  const page = [...headerLines({ dTotal: '0.00', dCount: 0, closing: '21,000.00' }), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,000.00' })];
  const { opening, rows } = run([page]);
  const days = buildDaily(rows, opening, '2026-06-09', '2026-06-09');
  assert.equal(days[0].flagged, 1);
  assert.equal(days[0].count, 1);
});

// Port of test_daily_summary_fills_in_quiet_days
test('days with no transactions still appear, carrying the balance', () => {
  const page = [...headerLines(), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' }),
    ...txLine(217, { date: '12-06-26', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '21,299.99' })];
  const { opening, rows, closing } = run([page]);
  const days = buildDaily(rows, opening, '2026-06-08', '2026-06-14');
  assert.deepEqual(days.map(d => d.date), [8, 9, 10, 11, 12, 13, 14].map(n => `2026-06-${String(n).padStart(2, '0')}`));
  assert.equal(days[0].count, 0); assert.equal(days[0].balance, opening);
  assert.equal(days[0].withdrawn, 0); assert.equal(days[0].deposited, 0);
  assert.equal(days[2].balance, 2123456);
  assert.equal(days[6].balance, closing);
  assert.equal(sum(days, 'withdrawn'), 1000000);
  assert.equal(days.filter(d => d.count).length, 2);
});

// Port of test_daily_summary_never_drops_a_dated_row
test('a row dated outside the bank\'s own period is shown, not dropped', () => {
  const page = [...headerLines({ dTotal: '0.00', dCount: 0, closing: '21,234.56' }), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' })];
  const { opening, rows } = run([page]);
  const days = buildDaily(rows, opening, '2026-07-01', '2026-07-03');
  assert.equal(days.length, 4);
  assert.equal(sum(days, 'withdrawn'), 1000000);
});

test('without a readable period only the active days are listed', () => {
  const page = [...headerLines(), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' })];
  const { opening, rows } = run([page]);
  assert.equal(buildDaily(rows, opening, null, null).length, 1);
});
