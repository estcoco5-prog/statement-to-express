import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, identify, columnOf } from '../src/engine/profiles.js';

test('six profiles in the Python order', () => {
  assert.deepEqual(Object.keys(PROFILES), ['kbank', 'scb', 'ktb', 'uob', 'bbl', 'kkp', 'ktbcorp']);
});

test('a column owns a word by its centre', () => {
  const k = PROFILES.kbank;
  assert.equal(columnOf(k, 226.2, 252.0), 'amount');
  assert.equal(columnOf(k, 306.4, 329.0), 'balance');
  assert.equal(columnOf(k, 0, 10), null);
});

// Port of test_bank_names_in_descriptions_do_not_fool_detection
test('a bank is recognised by its own header, never by names in descriptions', () => {
  const scb = 'THE SIAM COMMERCIAL BANK PUBLIC COMPANY LIMITED\n19 มบ.ธนาคารกรุงเทพ ม.1\n' +
              'รับโอนจาก ธนาคารกรุงไทย K PLUS UOB/TMRW ONE Account ธนาคารไทยพาณิชย์';
  assert.equal(identify(scb).key, 'scb');
  assert.equal(identify('Bangkok Bank Public Company Limited\nTRF FROM KBANK K PLUS').key, 'bbl');
  assert.equal(identify('โอนไป ธนาคารกรุงไทย ธนาคารไทยพาณิชย์ K PLUS'), null);
  assert.equal(identify('รายการเดินบัญชีเงินฝาก\nP-S001217-66-004').key, 'kkp');
});

test('every profile carries every mark key', () => {
  const keys = ['identify', 'opening', 'closing', 'total_withdraw', 'total_deposit',
    'total_items', 'totals_line', 'period', 'account_no', 'account_name', 'branch',
    'footer', 'furniture_text'];
  for (const p of Object.values(PROFILES))
    for (const k of keys) assert.ok(Array.isArray(p.marks[k]), `${p.key}.${k}`);
});

test('every measured bank carries at least 3 distinct header anchors', () => {
  for (const p of Object.values(PROFILES)) {
    assert.ok(Array.isArray(p.anchors) && p.anchors.length >= 3, p.key);
    assert.equal(new Set(p.anchors.map(a => a.text)).size, p.anchors.length, p.key);
    for (const a of p.anchors) assert.ok(a.x0 >= 0 && a.x0 < 850 && a.y0 >= 0 && a.y0 < 850, `${p.key} ${a.text}`);
  }
});
