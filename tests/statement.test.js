import { test } from 'node:test';
import assert from 'node:assert/strict';
import pdfjs from './pdfjs.js';
import { Statement, statusOf, readStatement } from '../src/engine/statement.js';
import { miniPdf } from './minipdf.js';

const facts = (o = {}) => ({ closing_stated: null, withdraw_total: null, deposit_total: null,
  withdraw_count: null, deposit_count: null, period_from: '01/07/2026', period_to: '31/07/2026', ...o });

// Port of test_unanchored_statement_is_at_most_yellow (status half)
test('green only with an independent anchor', () => {
  const pass = [['x', true, '']];
  assert.equal(statusOf(new Statement('a', {}, facts({ closing_stated: 1 }), 0, [], 1, pass)), 'green');
  assert.equal(statusOf(new Statement('a', {}, facts({ deposit_count: 0 }), 0, [], 1, pass)), 'green');
  assert.equal(statusOf(new Statement('a', {}, facts(), 0, [], 1, pass)), 'yellow');
  assert.equal(statusOf(new Statement('a', {}, facts(), 0, [], 1, [['x', false, '']])), 'red');
});

test('bounds come from the printed period, in ISO', () => {
  assert.deepEqual(new Statement('a', {}, facts(), 0, [], 0, []).bounds, ['2026-07-01', '2026-07-31']);
  assert.equal(new Statement('a', {}, facts({ period_from: null }), 0, [], 0, []).bounds, null);
});

// A made-up UOB-shaped statement, drawn with a standard font (its labels are
// all English, which a standard font can carry; Thai cannot be drawn this way).
const uobLike = () => miniPdf([
  [47.3, 60, 'Period: 01 Oct 2025 to 31 Oct 2025'],
  [52.5, 100, 'ONE Account 1234567890'],
  [52.5, 120, 'Account Transaction Details'],
  [52.5, 150, '01 Oct'], [105.5, 150, '01 Oct'], [149.2, 150, 'BALANCE B/F'], [515, 150, '20,000.00'],
  [52.5, 170, '02 Oct'], [105.5, 170, '02 Oct'], [149.2, 170, 'PAY'], [430, 170, '500.00'], [515, 170, '20,500.00'],
  [105.5, 200, 'Total'], [360, 200, '0.00'], [430, 200, '500.00'], [515, 200, '20,500.00'],
]);

test('readStatement reads, identifies, proves and anchors a statement', async () => {
  const s = await readStatement('uob.pdf', uobLike(), [], null, pdfjs);
  assert.equal(s.profile.key, 'uob');
  assert.equal(s.name, 'uob.pdf');
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].deposit, 50000);
  assert.equal(s.rows[0].date, '2025-10-02');
  assert.equal(s.facts.closing_stated, 2050000);
  assert.equal(s.facts.account_no, '1234567890');
  assert.equal(statusOf(s), 'green');
});

test('the same bytes survive several password attempts', async () => {
  const bytes = uobLike();
  const s = await readStatement('uob.pdf', bytes, ['first', 'second'], null, pdfjs);
  assert.equal(s.rows.length, 1);
  assert.equal(bytes.length > 100, true);
});

test('an unknown bank is refused with its own code', async () => {
  const bytes = miniPdf([[41, 275, '01/10/2025'], [100, 275, 'NOT A KNOWN BANK']]);
  await assert.rejects(readStatement('x.pdf', bytes, [], null, pdfjs), e => e.code === 'unknown-bank');
});
