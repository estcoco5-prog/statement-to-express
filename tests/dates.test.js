import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveYear, parseDate, parseDMon, periodDates, setToday, addDays } from '../src/engine/dates.js';
import { StatementError } from '../src/engine/errors.js';

// Port of test_year_resolution_rules
test('year resolution refuses to guess', () => {
  assert.deepEqual(resolveYear('26', '01/06/2026', '30/06/2026'), [2026, null]);
  assert.deepEqual(resolveYear('69', '01/06/2569', '30/06/2569'), [2026, null]);
  assert.deepEqual(resolveYear('2569', '01/06/2569', '30/06/2569'), [2026, null]);
  const [, warn] = resolveYear('99', '01/06/2026', '30/06/2026');
  assert.notEqual(warn, null);
  assert.throws(() => resolveYear('26', null, null), StatementError);
});

test('a year outside the period is reported with the Python wording', () => {
  const [y, warn] = resolveYear('2030', '01/06/2026', '30/06/2026');
  assert.equal(y, 2030);
  assert.equal(warn, 'year 2030 is outside the statement period');
});

test('parseDate gives ISO and rejects impossible dates', () => {
  const facts = { period_from: '01/06/2026', period_to: '30/06/2026' };
  assert.deepEqual(parseDate('09-06-26', facts), ['2026-06-09', null]);
  assert.deepEqual(parseDate('TRANSFER', facts), [null, null]);
  // the misread from a real photo: flagged, never guessed
  assert.deepEqual(parseDate('01/40/25', { period_from: '01/10/2025', period_to: '30/09/2026' }),
    [null, '01/40/25 is not a real date']);
});

// Port of test_two_digit_period_year_that_fits_neither_calendar_refuses
test('a 2-digit period year that fits no plausible window is refused', () => {
  setToday(() => '2026-10-01');
  assert.throws(() => periodDates('01/10/90 ถึง 31/10/90'), StatementError);
});

test('2-digit period years use the 20-year window ending today', () => {
  setToday(() => '2026-10-02');
  assert.deepEqual(periodDates('01/10/68 - 30/09/69'), ['01/10/2025', '30/09/2026']);
  assert.deepEqual(periodDates('Period: 01 Sep 2026 - 30 Sep 2026'), ['01/09/2026', '30/09/2026']);
});

test('d_mon dates take their year from the period, even just after it ends', () => {
  const facts = { period_from: '01/09/2026', period_to: '30/09/2026' };
  assert.deepEqual(parseDMon('01 Sep', facts), ['2026-09-01', null]);
  assert.deepEqual(parseDMon('01 Oct', facts), ['2026-10-01', null]);
  assert.deepEqual(parseDMon('15 Mar', facts), [null, '15 Mar cannot be placed in the statement period']);
  assert.throws(() => parseDMon('01 Sep', { period_from: null, period_to: null }), StatementError);
});

test('addDays crosses month and leap-year ends in UTC', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
