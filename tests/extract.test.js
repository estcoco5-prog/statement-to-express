import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Row, appendWrapped, extractRows, checkRowSanity, cellsByColumn, flagFurniture } from '../src/engine/extract.js';
import { parseHeader } from '../src/engine/header.js';
import { groupIntoRows } from '../src/engine/rows.js';
import { setToday } from '../src/engine/dates.js';
import { StatementError } from '../src/engine/errors.js';
import { PROFILES } from '../src/engine/profiles.js';
import { word, rightAligned } from './helpers.js';
import { txLine, headerLines, pageHeaderBlock, openingLine, ktbLine, ktbPage } from './fixtures.js';

const { kbank: KBANK, ktb: KTB, kkp: KKP } = PROFILES;

function extract(pages, profile = KBANK) {
  const facts = parseHeader(pages.flatMap(p => groupIntoRows(p)), profile);
  return { facts, ...extractRows(pages, profile, facts) };
}

test('a clean statement: opening and both rows read', () => {
  const page = [...headerLines(), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', time: '13:39', desc: 'โอนเงิน', withdraw: '10,000.00',
      balance: '21,234.56', channel: 'K PLUS', details: 'โอนไป X0000' }),
    ...txLine(217, { date: '19-06-26', time: '23:59', desc: 'รับดอกเบี้ยเงินฝาก', deposit: '65.43',
      balance: '21,299.99', channel: 'โอนเข้า' })];
  const { opening, rows } = extract([page]);
  assert.equal(opening, 3123456);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].date, rows[0].time, rows[0].description, rows[0].amount, rows[0].balance,
    rows[0].channel, rows[0].details],
  ['2026-06-09', '13:39', 'โอนเงิน', 1000000, 2123456, 'K PLUS', 'โอนไป X0000']);
  assert.equal(rows[1].amountX1, 267.0);
});

// Port of test_wrapped_description
test('a description wrapping onto a second line stays one transaction', () => {
  const page = [...headerLines({ dTotal: '0.00', dCount: 0, closing: '21,234.56' }), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56',
      details: 'โอนไป X0000 นาย' }),
    ...txLine(217, { details: 'สมศรี ใจดี' })];
  const { rows } = extract([page]);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].details.includes('สมศรี'), rows[0].details);
});

// Port of test_multi_page (extraction half)
test('transactions accumulate across pages', () => {
  const page1 = [...headerLines(), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' })];
  const page2 = txLine(205, { date: '19-06-26', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '21,299.99' });
  assert.equal(extract([page1, page2]).rows.length, 2);
});

// Port of test_footer_is_not_data
test('page furniture below the transactions is ignored', () => {
  const page = [...headerLines({ dTotal: '0.00', dCount: 0, closing: '21,234.56' }), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' }),
    word('KBPDF', 52.0, 733.0),
    ...txLine(745, { date: '29-06-26', desc: 'ไม่ใช่รายการ', withdraw: '1.00', balance: '0.00' })];
  assert.equal(extract([page]).rows.length, 1);
});

// Port of test_margin_stamp_level_with_a_transaction
test('a margin stamp printed level with the last row does not eat it', () => {
  const page = [...headerLines({ wTotal: '10,001.00', wCount: 2, dTotal: '0.00', dCount: 0, closing: '22,040.14' }),
    ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' }),
    word('KBPDF', 52.0, 739.0),
    ...txLine(738.6, { date: '10-06-26', desc: 'ชำระเงิน', withdraw: '1.00', balance: '22,040.14' })];
  const { rows } = extract([page]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].amount, 100);
});

// Port of test_carry_forward_is_not_a_new_starting_point
test('the carry-forward reprinted on each page is not a new opening', () => {
  const page1 = [...headerLines(), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' })];
  const page2 = [...openingLine(193, '21,234.56', '19-06-26'),
    ...txLine(205, { date: '19-06-26', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '21,299.99' })];
  const { opening, rows } = extract([page1, page2]);
  assert.equal(opening, 3123456);
  assert.equal(rows.length, 2);
});

// Port of test_page_header_does_not_leak_into_the_previous_row
test("a new page's header does not glue itself onto the last row before it", () => {
  const page1 = [...headerLines(), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56',
      details: 'เพื่อชำระ Ref X1111' })];
  const page2 = [...pageHeaderBlock(), ...openingLine(199, '21,234.56', '19-06-26'),
    ...txLine(211, { date: '19-06-26', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '21,299.99' })];
  const { rows } = extract([page1, page2]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].details, 'เพื่อชำระ Ref X1111');
});

// Port of test_wrap_still_joins_on_the_same_page
test('a real wrapped line on the same page is still joined', () => {
  const page = [...headerLines({ dTotal: '0.00', dCount: 0, closing: '21,234.56' }), ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56',
      details: 'SCB มณี SHOP (GRL' }),
    word('TOYS)', 404.0, 217.0)];
  const { rows } = extract([page]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].details, 'SCB มณี SHOP (GRL TOYS)');
});

// Port of test_leaked_furniture_is_flagged_not_silent (flag half)
test('furniture inside a row is flagged', () => {
  const row = new Row();
  row.details = 'โอนไป X0000 หน้าที่ (PAGE/OF) 7/13 987-6-54321-0';
  flagFurniture(row, KBANK);
  assert.equal(row.notes.length, 1);
  assert.match(row.notes[0], /^page furniture leaked into this row's text \(หน้าที่\)/);
});

// Port of test_missing_opening_balance_refuses
test('without an opening balance it refuses rather than guessing', () => {
  const page = [...headerLines(),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' })];
  assert.throws(() => extract([page]), e => e instanceof StatementError && /opening balance/.test(e.message));
});

// Port of test_row_grouping_sanity
test('two dates landing on one line is caught, not averaged away', () => {
  const line = [word('09-06-26', 67.9, 205.0, 24.2), word('19-06-26', 70.0, 206.0, 24.2)];
  assert.throws(() => checkRowSanity(cellsByColumn(line, KBANK)), StatementError);
});

// Port of test_ktb_buddhist_two_digit_years_and_derived_opening (extraction half)
test('KTB: 2-digit BE years, derived opening, 0.00 tax skipped, time below', () => {
  setToday(() => '2026-10-01');
  const page = ktbPage([
    ktbLine(100, '10/10/68', 'เงินโอนเข้า', '000-1112223334', { deposit: '2,000.00', balance: '26,111.22', time: '08:35' }),
    ktbLine(125, '17/10/68', 'จ่ายค่าสินค้า/บริการ', 'KTC-0000', { withdraw: '5,800.00', balance: '20,311.22', time: '14:51' }),
    ktbLine(150, '31/12/68', 'ดอกเบี้ยและภาษี', null, { withdraw: '0.00', deposit: '5.09', balance: '20,316.31', time: '01:40' }),
    [word('รายการถอนทั้งหมด', 39.7, 200), word('1', 102.0, 200, 3.7), word('5,800.00', 158.7, 200)],
    [word('รายการฝากทั้งหมด', 39.7, 215), word('2', 102.0, 215, 3.7), word('2,005.09', 158.7, 215)],
  ]);
  const { facts, opening, rows } = extract([page], KTB);
  setToday(null);
  assert.equal(facts.period_from, '01/10/2025');
  assert.equal(rows[0].date, '2025-10-10');
  assert.equal(opening, 2411122);
  assert.equal(facts.opening_derived, true);
  assert.equal(rows[2].amount, 509);
  assert.equal(rows[0].time, '08:35');
  assert.equal(facts.withdraw_count, 1);
  assert.equal(facts.deposit_count, 2);
});

// Port of test_kkp_layout_and_thai_wrap (extraction half)
test('KKP: opening row, Thai wrap joins without a space', () => {
  const page = [
    word('01/10/2025', 41.0, 275), word('ยอดยกมา', 126.4, 275), rightAligned('51,234.50', 388.4, 275),
    word('01/10/2025', 41.0, 295), word('รับเงินโอนจากต่าง', 85.8, 295, 59.5),
    rightAligned('7,135.79', 294.4, 295), rightAligned('58,370.29', 388.4, 295),
    word('PROMPTPAY', 392.9, 295, 47.0),
    word('ธนาคาร', 85.7, 311, 26.4),
    word('02/10/2025', 41.0, 331), word('ชําระเงิน', 85.8, 331, 28.0),
    rightAligned('7,000.00', 226.9, 331), rightAligned('51,370.29', 388.4, 331),
    word('DIME', 406.8, 331, 19.2),
  ];
  const facts = { period_from: '01/10/2025', period_to: '01/10/2026' };
  const { opening, rows } = extractRows([page], KKP, facts);
  assert.equal(opening, 5123450);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].description, 'รับเงินโอนจากต่างธนาคาร');
  assert.equal(rows[0].channel, 'PROMPTPAY');
});

test('a wrapped English description still gets a space', () => {
  const row = new Row(); row.description = 'CC/LN PAYMENT';
  appendWrapped(row, { description: [word('EPY', 149, 10)] });
  assert.equal(row.description, 'CC/LN PAYMENT EPY');
});

test('a wrapped Thai phrase joins with no space', () => {
  const row = new Row(); row.description = 'รับเงินโอนจากต่าง';
  appendWrapped(row, { description: [word('ธนาคาร', 85.7, 311, 26.4)] });
  assert.equal(row.description, 'รับเงินโอนจากต่างธนาคาร');
});

test('a time on the continuation line fills an empty time', () => {
  const row = new Row();
  appendWrapped(row, { date: [word('08:35', 39.7, 111)] });
  assert.equal(row.time, '08:35');
});

// Measured on BBL photos (simulated phone photo and small picture): the reader
// prints "B/F" as "BF". In a PDF made from photos the opening label is found
// whatever spaces or slashes the reader dropped; a bank's own PDF stays exact.
test('a photo-read opening label is found without its slash', () => {
  const profile = { ...KBANK, marks: { ...KBANK.marks, opening: ['B/F'] } };
  const page = () => [...headerLines(),
    word('01-06-26', 67.9, 193, 24.2), word('BF', 123.0, 193), rightAligned('31,234.56', 329.0, 193),
    ...txLine(205, { date: '09-06-26', time: '13:39', desc: 'โอนเงิน', withdraw: '10,000.00',
      balance: '21,234.56', channel: 'K PLUS', details: 'โอนไป X0000' })];
  const photo = [page()];
  Object.defineProperty(photo, 'source', { value: 'photo' });
  assert.equal(extract(photo, profile).opening, 3123456);
  const pdf = [page()];
  Object.defineProperty(pdf, 'source', { value: 'pdf' });
  assert.throws(() => extract(pdf, profile), /opening balance row/);
});
