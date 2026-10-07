import { test } from 'node:test';
import assert from 'node:assert/strict';
import pdfjs from '../pdfjs.js';
import { readStatement, statusOf } from '../../src/engine/statement.js';
import { buildWorkbook } from '../../src/engine/output/review.js';
import { PHOTO_CAVEAT } from '../../src/engine/general.js';
import { buildReadablePdf } from '../../src/photo/pdfwrite.js';
import { kbankPageWords } from './madeup.js';
import { TINY_JPEG } from './tinyjpeg.js';

test('a statement read from a photo is never green, and says so on the Proof sheet', async () => {
  const pdf = buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words: kbankPageWords() }]);
  const st = await readStatement('photo.pdf', pdf, [], null, pdfjs);
  assert.equal(st.profile.key, 'kbank');
  assert.deepEqual(st.checks.filter(c => !c[1]), []);           // every check passes...
  assert.equal(st.fromPhoto, true);
  assert.equal(statusOf(st), 'yellow');                          // ...and it is still only yellow
  const proof = buildWorkbook(st.rows, st.opening, st.closing, st.facts, st.checks, st.profile, 'photo.pdf', st.fromPhoto)[2];
  assert.equal(proof.rows[0][0].value, PHOTO_CAVEAT);
});

test('an ordinary bank PDF is not treated as a photo', async () => {
  const { miniPdf } = await import('../minipdf.js');
  const { readWords } = await import('../../src/engine/words.js');
  const pages = await readWords(miniPdf([[72, 700, 'Hello 1,000.00']]), null, pdfjs);
  assert.equal(pages.source, 'pdf');
});
