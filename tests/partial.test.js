// Co 2026-10-07 decision B: a statement read from photos that fails only for
// money completeness (some rows not proved) still gives Express its PROVED
// rows; the rest are listed, with their photo page, as rows to check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partialRows } from '../src/engine/statement.js';
import { groupBatch } from '../src/engine/batch.js';
import { expressFiles, buildRowsToCheck } from '../src/engine/output/express.js';
import { stmt, row } from './statements.js';

const CHAIN = 'Every row agrees with the running balance';
function photoStatement(checks) {
  const good1 = row('2026-07-02', '10.00', '90.00'); good1.page = 1;
  const bad = row('2026-07-03', '5.00', '80.00'); bad.verified = false; bad.notes.push('balance does not agree'); bad.page = 2;
  const good2 = row('2026-07-04', '20.00', '60.00'); good2.page = 2;
  const good3 = row('2026-07-05', '10.00', '50.00'); good3.page = 2;
  const s = stmt('scb', '1112223334', '01/07/2026', '31/07/2026', '100.00', '50.00', { rows: [good1, bad, good2, good3] });
  s.checks = checks; s.fromPhoto = true;
  return s;
}

test('photo, only money checks failed: the proved rows go to Express', () => {
  const s = photoStatement([[CHAIN, false, ''], ["Number of withdrawals matches the bank's own count", false, ''],
    ['Final balance matches the closing balance the bank printed', true, '']]);
  // 07-02 agrees with itself but sits right before the broken row, so its
  // balance is in doubt; 07-04 was checked against that broken row's balance.
  // Both go to Rows to check, not to Express.
  assert.deepEqual(partialRows(s).map(r => r.date), ['2026-07-05']);
  const [out] = expressFiles(groupBatch([s]));
  assert.equal(out.n, 1);
  const check = out.sheets.find(sh => sh.name === 'Rows to check');
  assert.ok(check, 'a Rows to check sheet');
  const text = check.rows.flat().map(c => String(c.value)).join(' | ');
  assert.match(text, /2026-07-03|03\/07\/2026/);
  assert.match(text, /balance does not agree/);
  assert.match(text, /\b2\b/);                              // its photo page
});

// G8 review probe: truth is 1,000.00 opening, 300.00 out (700.00), 200.00 in
// (900.00). The reader turns 3 into 8 in BOTH the amount and the balance of
// row 1, so row 1 agrees with itself; only row 2 breaks. Row 1 must not reach
// Express, or the file is 500.00 out with nothing pointing at it.
test('a row misread consistently in amount AND balance never reaches Express', () => {
  const r1 = row('2026-07-02', '800.00', '200.00'); r1.page = 1;          // 300.00 / 700.00 misread
  const r2 = row('2026-07-03', '200.00', '900.00'); r2.verified = false; r2.notes.push('balance chain broken'); r2.page = 1;
  const r3 = row('2026-07-04', '50.00', '850.00'); r3.page = 1;
  const r4 = row('2026-07-05', '50.00', '800.00'); r4.page = 1;
  const s = stmt('scb', '1112223334', '01/07/2026', '31/07/2026', '1000.00', '800.00', { rows: [r1, r2, r3, r4] });
  s.checks = [[CHAIN, false, ''], ['Final balance matches the closing balance the bank printed', true, '']];
  s.fromPhoto = true;
  assert.deepEqual(partialRows(s).map(r => r.date), ['2026-07-05']);
  const text = buildRowsToCheck(groupBatch([s])[0]).rows.flat().map(c => String(c.value)).join(' | ');
  assert.match(text, /2026-07-02|02\/07\/2026/);
  assert.match(text, /row after it does not confirm/);
});

// G8 passbook review probe S2: one repeated misread, a 3 read as 8 in the
// balance ABOVE and in this line's amount, cancels out - this line agrees with
// a balance that was never proved. It must not reach Express.
test('a line checked against an unproved balance above never reaches Express', () => {
  const r1 = row('2026-07-02', '345.00', '12845.00'); r1.page = 1;      // truth 12,345.00
  r1.verified = false; r1.notes.push('balance chain broken'); r1.withdrawal = null; r1.deposit = 34500;
  const r2 = row('2026-07-03', '2800.00', '10045.00'); r2.page = 1;      // truth 2,300.00 - agrees with the misread
  const r3 = row('2026-07-04', '5.00', '10040.00'); r3.page = 1;
  const r4 = row('2026-07-05', '1.00', '10039.00'); r4.page = 1;
  const s = stmt('scb', '1112223334', '01/07/2026', '31/07/2026', '12000.00', '10039.00', { rows: [r1, r2, r3, r4] });
  s.checks = [[CHAIN, false, ''], ['Final balance matches the closing balance the bank printed', true, '']];
  s.fromPhoto = true;
  const sent = partialRows(s).map(r => r.date);
  assert.ok(!sent.includes('2026-07-03'), 'the 2,800.00 must be held back');
  assert.deepEqual(sent, ['2026-07-04', '2026-07-05']);
});

test('the last row needs the closing balance to confirm it', () => {
  const s = photoStatement([[CHAIN, false, ''], ['Final balance matches the closing balance the bank printed', false, '']]);
  assert.equal(partialRows(s), null);               // 07-02 before the break, 07-04 unconfirmed
});

test('photo, a date check failed: nothing goes to Express', () => {
  const s = photoStatement([[CHAIN, false, ''], ['Dates never go backwards', false, '']]);
  assert.equal(partialRows(s), null);
  assert.ok(expressFiles(groupBatch([s]))[0].refused);
});

test('a bank PDF that failed keeps the old rule: no Express file', () => {
  const s = photoStatement([[CHAIN, false, '']]);
  s.fromPhoto = false;
  assert.equal(partialRows(s), null);
  assert.ok(expressFiles(groupBatch([s]))[0].refused);
});
