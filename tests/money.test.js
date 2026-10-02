import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, fmtMoney, pyFloat } from '../src/engine/money.js';

test('parseAmount reads money shapes only', () => {
  assert.equal(parseAmount('10,000.00'), 1000000);
  assert.equal(parseAmount('65.43'), 6543);
  assert.equal(parseAmount('1234.56'), 123456);
  assert.equal(parseAmount('0.00'), 0);
  assert.equal(parseAmount('1,23.00'), null);     // bad grouping
  assert.equal(parseAmount('10,000'), null);      // no decimals
  assert.equal(parseAmount('12.3'), null);
  assert.equal(parseAmount('X9QZ7'), null);
});

test('fmtMoney matches Python str(Decimal)', () => {
  assert.equal(fmtMoney(9945956), '99459.56');
  assert.equal(fmtMoney(-1000000), '-10000.00');
  assert.equal(fmtMoney(5), '0.05');
  assert.equal(fmtMoney(-5), '-0.05');
});

test('pyFloat matches Python repr(float(Decimal))', () => {
  assert.equal(pyFloat(750000), '7500.0');
  assert.equal(pyFloat(123456), '1234.56');
  assert.equal(pyFloat(6543), '65.43');
  assert.equal(pyFloat(10), '0.1');
  assert.equal(pyFloat(0), '0.0');
});
