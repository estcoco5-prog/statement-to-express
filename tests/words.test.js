import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitRun, placeRun, Word } from '../src/engine/words.js';

const near = (a, b, tol = 1.0) => Math.abs(a - b) <= tol;

test('one-word run keeps its exact edges', () => {
  const [w] = splitRun('7,135.79', 263.7, 294.4, 294, 306);
  assert.equal(w.text, '7,135.79'); assert.equal(w.x0, 263.7); assert.equal(w.x1, 294.4);
});

test('balance + channel run splits where Poppler splits (KKP, measured)', () => {
  const ws = splitRun('48,123.45 PROMPTPAY', 353.6, 439.9, 294, 306);
  assert.deepEqual(ws.map(w => w.text), ['48,123.45', 'PROMPTPAY']);
  assert.ok(near(ws[0].x1, 388.4), `got ${ws[0].x1}`);
  assert.ok(near(ws[1].x0, 392.9), `got ${ws[1].x0}`);
  assert.equal(ws[1].x1, 439.9);
});

test('date + Thai run splits into two words, outer edges exact', () => {
  const ws = splitRun('01/10/2025 รับเงินโอนจากต่าง', 41.0, 145.3, 294, 306);
  assert.deepEqual(ws.map(w => w.text), ['01/10/2025', 'รับเงินโอนจากต่าง']);
  assert.equal(ws[0].x0, 41.0); assert.equal(ws[1].x1, 145.3);
  assert.ok(ws[0].x1 < 85.8 && ws[0].x1 > 75, `date ends at ${ws[0].x1}`);
});

test('blank and space-only runs give nothing', () => {
  assert.deepEqual(splitRun('   ', 0, 10, 0, 8), []);
});

test('Word.ycentre', () => assert.equal(new Word(0, 10, 5, 20, 'x').ycentre, 15));

const exact = (a, b) => Math.abs(a - b) < 0.01;

test('placeRun: a flat word spans the font ascent to descent, as Poppler measures it', () => {
  // 10pt, baseline 102pt from the bottom of an 842pt page, ascent 0.746, descent -0.407
  // -> Poppler: top 842-102-7.46 = 732.54, bottom 842-102+4.07 = 744.07.
  const [w] = placeRun('กระทรวง', [10, 0, 0, 10, 404, 102], 47.4, 0.746, -0.407, 842);
  assert.ok(exact(w.x0, 404) && exact(w.x1, 451.4), `x ${w.x0}-${w.x1}`);
  assert.ok(exact(w.y0, 732.54) && exact(w.y1, 744.07), `y ${w.y0}-${w.y1}`);
});

test('placeRun: sideways text (KBPDF margin stamp) runs UP the page, narrow and tall', () => {
  // Rotated 90 degrees: 7pt glyphs advancing upward from baseline origin (57.2, 96).
  // Poppler: x 51.98-60.05, y from 746 upward by the run's length.
  const words = placeRun('AB', [0, 7, -7, 0, 57.2, 96], 20, 0.746, -0.407, 842);
  assert.equal(words.length, 1);
  const [w] = words;
  assert.ok(exact(w.x0, 51.978) && exact(w.x1, 60.049), `x ${w.x0}-${w.x1}`);
  assert.ok(exact(w.y0, 726) && exact(w.y1, 746), `y ${w.y0}-${w.y1}`);
});

test('placeRun: words of a sideways run stack along the page, first word lowest', () => {
  const [a, b] = placeRun('AB CD', [0, 7, -7, 0, 57.2, 96], 30, 0.746, -0.407, 842);
  assert.equal(a.text, 'AB');
  assert.equal(b.text, 'CD');
  assert.ok(exact(a.y1, 746) && b.y1 <= a.y0, `a ${a.y0}-${a.y1} b ${b.y0}-${b.y1}`);
});

import pdfjs from './pdfjs.js';
import { readWords } from '../src/engine/words.js';
import { miniPdf } from './minipdf.js';

test('readWords reads a PDF page into positioned words', async () => {
  const pages = await readWords(miniPdf([[60, 100, '09-06-26 TRANSFER'], [300, 100, '2,345.67']]), null, pdfjs);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].map(w => w.text), ['09-06-26', 'TRANSFER', '2,345.67']);
  assert.ok(Math.abs(pages[0][0].x0 - 60) < 0.01);
  assert.ok(pages[0][0].y0 < 100 && pages[0][0].y1 > 95, `y ${pages[0][0].y0}-${pages[0][0].y1}`);
});

// Poppler (the answer key) reads a span's ActualText INSTEAD of the glyphs
// inside it, placed over the space those glyphs cover.
const spans = pieces => miniPdf([[60, 100, pieces]]);

test('readWords reads ActualText instead of garbage glyphs (UOB: one span per run)', async () => {
  const pages = await readWords(spans([['82%#', 'UOB/ '], ['&$6+', 'CASH']]), null, pdfjs);
  assert.deepEqual(pages[0].map(w => w.text), ['UOB/', 'CASH']);
});

test('one-letter spans that touch join into one word (UOB Thai)', async () => {
  const pages = await readWords(spans([['8', 'จ'], ['%', '่'], ['#', 'า'], ['Q', 'ย']]), null, pdfjs);
  assert.deepEqual(pages[0].map(w => w.text), ['จ่าย']);
});

test('an ActualText space breaks the word', async () => {
  const pages = await readWords(spans([['8', 'U'], ['%', 'O'], ['#', ' '], ['Q', 'B']]), null, pdfjs);
  assert.deepEqual(pages[0].map(w => w.text), ['UO', 'B']);
});

test('the same glyph reads differently in different spans; text outside spans stays as printed', async () => {
  const pages = await readWords(miniPdf([[60, 100, [['8', 'U']]], [60, 200, [['8', 'V']]], [60, 300, '8%']]), null, pdfjs);
  assert.deepEqual(pages[0].map(w => w.text), ['U', 'V', '8%']);
});

test('pieces printed outside any span join as usual', async () => {
  const pages = await readWords(spans([['TRANS', null], ['FER', null]]), null, pdfjs);
  assert.deepEqual(pages[0].map(w => w.text), ['TRANSFER']);
});

// KTB Corporate: pages stored sideways, and a font whose tone marks / digits
// have no real character. Made-up words only.
import { cleanGlyphs, multiply, uprightMatrix } from '../src/engine/words.js';

test('broken tone marks become a word break, broken digits vanish', () => {
  assert.equal(cleanGlyphs('ทดสอบÉคำ'), 'ทดสอบ คำ');
  assert.equal(cleanGlyphs('กขÊค'), 'กข ค');
  assert.equal(cleanGlyphs('ทดสอบ/řŘŠ'), 'ทดสอบ/');
  assert.equal(cleanGlyphs('Café 1,000.00'), 'Café 1,000.00');   // Latin text left alone
});

test('a page turned 90 degrees reads upright', () => {
  // pdf.js viewport for a 595x842 page with /Rotate 90 at scale 1.
  const vt = [0, 1, 1, 0, 0, 0];
  const m = uprightMatrix(vt, 595);
  // Text written up the unturned page at (100, 50) lands at x=50 on the turned one.
  const t = multiply(m, [0, 1, -1, 0, 100, 50]);
  assert.deepEqual(t.slice(0, 4), [1, 0, 0, 1]);   // now reads left to right
  assert.equal(t[4], 50);
  assert.equal(t[5], 595 - 100);
  assert.deepEqual(uprightMatrix([1, 0, 0, -1, 0, 842], 842), [1, 0, 0, 1, 0, 0]);   // unturned: unchanged
});
