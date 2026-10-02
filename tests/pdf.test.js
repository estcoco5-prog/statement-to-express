// Real PDFs end to end through pdf.js, and every refusal path (Review Focus 1-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pdfjs from './pdfjs.js';
import { readStatement, statusOf } from '../src/engine/statement.js';
import { miniPdf } from './minipdf.js';

// A made-up UOB-shaped statement (English labels; a standard font cannot draw Thai).
const STATEMENT = [
  [47.3, 60, 'Period: 01 Oct 2025 to 31 Oct 2025'],
  [52.5, 100, 'ONE Account 1234567890'],
  [52.5, 120, 'Account Transaction Details'],
  [52.5, 150, '01 Oct'], [105.5, 150, '01 Oct'], [149.2, 150, 'BALANCE B/F'], [515, 150, '20,000.00'],
  [52.5, 170, '02 Oct'], [105.5, 170, '02 Oct'], [149.2, 170, 'PAY'], [430, 170, '500.00'], [515, 170, '20,500.00'],
  [105.5, 200, 'Total'], [360, 200, '0.00'], [430, 200, '500.00'], [515, 200, '20,500.00'],
];
const codeOf = async p => { try { await p; return 'ok'; } catch (e) { return e.code ?? String(e); } };

test('a made-up statement PDF proves green', async () => {
  const s = await readStatement('s.pdf', miniPdf(STATEMENT), [], null, pdfjs);
  assert.equal(s.profile.key, 'uob');
  assert.equal(statusOf(s), 'green');
});

test('locked without a password asks for one', async () =>
  assert.equal(await codeOf(readStatement('l.pdf', miniPdf(STATEMENT, { password: 'testpw' }), [], null, pdfjs)), 'locked'));

test('locked with the wrong password says so', async () =>
  assert.equal(await codeOf(readStatement('l.pdf', miniPdf(STATEMENT, { password: 'testpw' }), ['nope'], null, pdfjs)), 'wrong-password'));

test('locked with the right password (after a wrong one) opens and proves', async () => {
  const s = await readStatement('l.pdf', miniPdf(STATEMENT, { password: 'testpw' }), ['nope', 'testpw'], null, pdfjs);
  assert.equal(statusOf(s), 'green');
});

test('a picture-only PDF is refused plainly', async () =>
  assert.equal(await codeOf(readStatement('p.pdf', miniPdf([], { image: true }), [], null, pdfjs)), 'no-text'));

test('a file that is not a PDF is refused plainly', async () =>
  assert.equal(await codeOf(readStatement('x.pdf', new TextEncoder().encode('hello'), [], null, pdfjs)), 'not-pdf'));

test('a statement from an unknown bank is refused plainly', async () => {
  const other = STATEMENT.map(([x, y, t]) => [x, y, t.replace('Account Transaction Details', 'Some Other Bank')]);
  assert.equal(await codeOf(readStatement('u.pdf', miniPdf(other), [], null, pdfjs)), 'unknown-bank');
});

test('no error message ever contains the password', async () => {
  for (const pw of ['s3cret-xyz']) {
    try {
      await readStatement('l.pdf', miniPdf(STATEMENT, { password: 'testpw' }), [pw], null, pdfjs);
      assert.fail('should not open');
    } catch (e) {
      assert.ok(!String(e.message).includes(pw));
      assert.ok(!String(e.stack ?? '').includes(pw));
    }
  }
});
