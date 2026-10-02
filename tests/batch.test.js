import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupBatch } from '../src/engine/batch.js';
import { stmt, row } from './statements.js';

const allOk = g => g.checks.every(([, ok]) => ok);

// Port of test_batch_links_months_and_groups_accounts
test('a batch links each month to the next and keeps accounts apart', () => {
  const groups = groupBatch([
    stmt('scb', '123-456789-0', '01/08/2026', '31/08/2026', '200.00', '300.00'),
    stmt('scb', '123-456789-0', '01/07/2026', '31/07/2026', '100.00', '200.00'),
    stmt('bbl', '111-2-33333-4', '01/10/2025', '30/09/2026', '5.00', '6.00'),
  ]);
  assert.equal(groups.length, 2);
  const scb = groups.find(g => g.profile.key === 'scb');
  assert.deepEqual(scb.statements.map(s => s.facts.period_from), ['01/07/2026', '01/08/2026']);
  assert.ok(allOk(scb));
  assert.deepEqual(scb.checks.at(-1), ['Each closing balance is the next opening balance', true, '1 of 1 links agree']);
  assert.equal(scb.status(scb.statements[0]), 'green');
});

// Port of test_batch_catches_a_gap_a_duplicate_and_a_broken_link
test('a batch reports a missing month, a doubled month and a broken link', () => {
  const gap = groupBatch([stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '200.00'),
    stmt('scb', '1', '01/09/2026', '30/09/2026', '200.00', '300.00')])[0];
  assert.ok(!allOk(gap));
  assert.deepEqual(gap.checks.find(c => c[0] === 'No month is missing'),
    ['No month is missing', false, 'gap: nothing covers 2026-08-01 to 2026-08-31']);

  const dup = groupBatch([stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '200.00', { name: 'a.pdf' }),
    stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '200.00', { name: 'b.pdf' })])[0];
  assert.deepEqual(dup.checks.find(c => c[0] === 'No statement appears twice'),
    ['No statement appears twice', false, '2026-07-01 to 2026-07-31 appears in both a.pdf and b.pdf']);

  const dupRows = groupBatch([
    stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '90.00', { name: 'a.pdf', rows: [row('2026-07-02', '10.00', '90.00')] }),
    stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '90.00', { name: 'b.pdf', rows: [row('2026-07-02', '10.00', '90.00')] }),
    stmt('scb', '1', '01/08/2026', '31/08/2026', '90.00', '80.00', { name: 'c.pdf', rows: [row('2026-08-02', '10.00', '80.00')] }),
  ])[0];
  assert.deepEqual(dupRows.expressRows().map(r => r.date), ['2026-07-02', '2026-08-02']);
  assert.deepEqual(dupRows.excluded().map(s => s.name), ['b.pdf']);
  assert.ok(dupRows.checks.some(([, , d]) => d.includes('1 of 1 links agree')));

  const broken = groupBatch([stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '200.00'),
    stmt('scb', '1', '01/08/2026', '31/08/2026', '250.00', '300.00')])[0];
  assert.deepEqual(broken.checks.at(-1), ['Each closing balance is the next opening balance', false,
    '2026-07-31 closes at 200.00 but 2026-08-01 opens at 250.00 (2026.pdf and 2026.pdf)']);
});

// Port of test_batch_express_file_excludes_red_months
test('a month that failed its own checks is left out of the combined file', () => {
  const good = stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '90.00', { rows: [row('2026-07-02', '10.00', '90.00')] });
  const bad = stmt('scb', '1', '01/08/2026', '31/08/2026', '90.00', '70.00', { ok: false, rows: [row('2026-08-02', '20.00', '70.00')] });
  const g = groupBatch([good, bad])[0];
  assert.deepEqual(g.expressRows().map(r => r.date), ['2026-07-02']);
  assert.deepEqual(g.excluded().map(s => s.name), [bad.name]);
  assert.equal(g.leftOutReason(bad), 'failed its own checks');
});

// Port of test_unanchored_statement_is_at_most_yellow (batch half)
test("next month's opening confirms an unanchored month: green", () => {
  const lonely = stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '200.00', { anchored: false });
  const next = stmt('scb', '1', '01/08/2026', '31/08/2026', '200.00', '300.00');
  const g = groupBatch([lonely, next])[0];
  assert.equal(g.status(lonely), 'green');
});

test('a statement whose account was not read is never merged', () => {
  const a = stmt('scb', null, '01/07/2026', '31/07/2026', '100.00', '200.00', { name: 'a.pdf' });
  const b = stmt('scb', null, '01/08/2026', '31/08/2026', '200.00', '300.00', { name: 'b.pdf' });
  const groups = groupBatch([a, b]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].account, null);
  assert.deepEqual(groups[0].checks, [['Only one statement for this account', true, 'nothing to link']]);
});

// Review Focus #4: the same statement chosen twice goes into Express once
test('the same statement chosen twice goes into Express once', () => {
  const a = stmt('scb', '123-456789-0', '01/07/2026', '31/07/2026', '100.00', '90.00',
    { name: 'July.pdf', rows: [row('2026-07-02', '10.00', '90.00')] });
  const b = stmt('scb', '123-456789-0', '01/07/2026', '31/07/2026', '100.00', '90.00',
    { name: 'July (1).pdf', rows: [row('2026-07-02', '10.00', '90.00')] });
  const [g] = groupBatch([a, b]);
  assert.equal(g.checks.find(c => c[0] === 'No statement appears twice')[1], false);
  assert.equal(g.expressRows().length, 1);
  assert.match(g.leftOutReason(b), /left out so nothing is imported twice/);
});

test('an unreadable period stops the linking with a named failure', () => {
  const a = stmt('scb', '1', '01/07/2026', '31/07/2026', '100.00', '200.00', { name: 'a.pdf' });
  const b = stmt('scb', '1', null, null, '200.00', '300.00', { name: 'b.pdf' });
  const [g] = groupBatch([a, b]);
  assert.deepEqual(g.checks, [["Every statement's period could be read", false, 'b.pdf']]);
});
