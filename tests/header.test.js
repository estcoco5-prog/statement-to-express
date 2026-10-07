import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHeader, looksLikeAccount, countIn } from '../src/engine/header.js';
import { groupIntoRows, rowText } from '../src/engine/rows.js';
import { PROFILES } from '../src/engine/profiles.js';
import { word, rightAligned } from './helpers.js';

const { kbank: KBANK, ktb: KTB, bbl: BBL } = PROFILES;

// Port of test_header_field_stops_at_block_edge (made-up values)
test('a labelled value stops at the edge of its block', () => {
  const line = [word('ชื่อบัญชี', 66.0, 73.0, 19.7), word('นาย', 90.0, 73.0, 10.3),
    word('สมชาย', 102.8, 73.0, 17.3),
    word('เลขที่อ้างอิง', 345.0, 71.0, 28.9),
    word('11111111111111111111', 393.0, 71.0, 64.6)];
  assert.equal(parseHeader([line], KBANK).account_name, 'นาย สมชาย');
});

// Port of test_account_number_read_by_its_shape (made-up numbers, same shapes)
test('the account number is read by its shape, not by spacing', () => {
  const ktbRow = [word('เลขที่บัญชี', 39.7, 133, 27.5), word('1234567890', 116.2, 133, 36.9),
    word('รหัสสาขา', 303.3, 133, 25.5), word('690', 396.9, 133, 11.0)];
  assert.equal(parseHeader([ktbRow], KTB).account_no, '1234567890');
  const bblRow = [word('เลขที่บัญชี/Account', 308.0, 93, 68.4), word('No.', 379.1, 93, 12.2),
    word('111-2-33333-4', 450.0, 93, 51.5)];
  assert.equal(parseHeader([bblRow], BBL).account_no, '111-2-33333-4');
  const other = [word('เงินโอนเข้า', 82.2, 300), word('000-1112223334', 209.8, 300, 50.3)];
  assert.equal(parseHeader([other], KTB).account_no, null);
});

test('KBank header block: period, closing, totals and counts', () => {
  const words = [
    word('ยอดยกไป', 345.0, 123.0), rightAligned('21,299.99', 533.0, 123.0),
    word('รวมถอนเงิน', 345.0, 136.0), word('1', 377.3, 136.0), word('รายการ', 383.0, 136.0),
    rightAligned('10,000.00', 533.0, 136.0),
    word('รวมฝากเงิน', 345.0, 149.0), word('1', 376.5, 149.0), word('รายการ', 382.2, 149.0),
    rightAligned('65.43', 533.0, 149.0),
    word('รอบระหว่างวันที่', 345.0, 97.0), word('01/06/2026', 393.0, 97.0),
    word('-', 424.6, 97.0), word('30/06/2026', 429.5, 97.0),
    word('เลขที่บัญชีเงินฝาก', 345.0, 84.0), word('123-4-56789-0', 393.0, 84.0),
  ];
  const facts = parseHeader(groupIntoRows(words), KBANK);
  assert.equal(facts.period_from, '01/06/2026');
  assert.equal(facts.period_to, '30/06/2026');
  assert.equal(facts.closing_stated, 2129999);
  assert.equal(facts.withdraw_total, 1000000);
  assert.equal(facts.withdraw_count, 1);
  assert.equal(facts.deposit_total, 6543);
  assert.equal(facts.deposit_count, 1);
  assert.equal(facts.account_no, '123-4-56789-0');
});

test('account shape and counts', () => {
  assert.ok(looksLikeAccount('123-4-56789-0'));
  assert.ok(looksLikeAccount('1234567890'));
  assert.ok(!looksLikeAccount('No.'));
  assert.ok(!looksLikeAccount('123456789'));            // 9 digits
  assert.ok(!looksLikeAccount(null));
  assert.equal(countIn('รวมถอนเงิน 1 รายการ 10,000.00'), 1);
  assert.equal(countIn('รายการถอนทั้งหมด 35 105,697.86', [word('35', 0, 0)]), 35);
  assert.equal(countIn('nothing here', []), null);
});

test('rows group by line and read left to right', () => {
  const rows = groupIntoRows([word('B', 50, 10), word('A', 10, 11), word('C', 10, 30)]);
  assert.deepEqual(rows.map(rowText), ['A B', 'C']);
});

// Photo reading splits Thai labels into pieces ("รายก" + "ารระหว่างวันที่",
// measured on the KTB Corporate page at 200 dpi): a label is found whatever
// spaces the pieces leave between them.
test('a label split into pieces by the photo reader is still found', () => {
  const row = [word('รายก', 15.5, 187.0, 13.5), word('ารระหว่างวันที่', 32.8, 187.0, 43.5),
    word('04/2026,05/2026,06/2026', 116.5, 187.0, 81.2)];
  const facts = parseHeader([row], PROFILES.ktbcorp);
  assert.equal(facts.period_from, '01/04/2026');
  assert.equal(facts.period_to, '30/06/2026');
});

// Measured on KBank photos: the reader skipped the small grey label
// "รอบระหว่างวันที่" but read the range beside it. In a PDF made from photos a
// single "date - date" range stands in for the label; two ranges, or a bank PDF,
// do not.
test('photo: one unlabelled date range is taken as the period', () => {
  const range = y => [word('01/06/2026', 393.0, y), word('-', 424.6, y), word('30/06/2026', 429.5, y)];
  assert.deepEqual(['period_from', 'period_to'].map(k => parseHeader([range(97)], KBANK, { photo: true })[k]),
    ['01/06/2026', '30/06/2026']);
  assert.equal(parseHeader([range(97)], KBANK).period_from, null);                       // bank PDF: label needed
  assert.equal(parseHeader([range(97), range(140)], KBANK, { photo: true }).period_from, null);  // two: refuse
});
