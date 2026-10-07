import { test } from 'node:test';
import assert from 'node:assert/strict';
import pdfjs from '../pdfjs.js';
import { photoPage } from '../../src/photo/pipeline.js';
import { rotatePoint } from '../../src/photo/geometry.js';
import { buildReadablePdf } from '../../src/photo/pdfwrite.js';
import { readStatement, statusOf } from '../../src/engine/statement.js';
import { kbankPageWords } from './madeup.js';
import { PROFILES } from '../../src/engine/profiles.js';
import { TINY_JPEG } from './tinyjpeg.js';

// The made-up KBank page as a phone would see it: scaled, shifted, tilted.
function asPhoto(words, { scale = 2.5, tilt = 1.5, dx = 40, dy = 70 } = {}) {
  return words.map(w => {
    const [x0, y0] = rotatePoint([w.x0 * scale + dx, w.y0 * scale + dy], tilt, [800, 1000]);
    return { text: w.text, x0, y0, x1: x0 + (w.x1 - w.x0) * scale, y1: y0 + (w.y1 - w.y0) * scale, conf: 92 };
  });
}

test('a tilted, scaled photo of a known bank lines back up to the PDF layout', () => {
  const page = photoPage(asPhoto(kbankPageWords()), { w: 1600, h: 2200 });
  assert.equal(page.ok, true, page.reason);
  assert.equal(page.bank, 'kbank');
  const orig = kbankPageWords();
  for (const w of page.words) {
    const same = orig.filter(x => x.text === w.text);   // "1" appears twice: take the nearest
    const o = same.reduce((a, b) => Math.hypot(a.x0 - w.x0, a.y0 - w.y0) <= Math.hypot(b.x0 - w.x0, b.y0 - w.y0) ? a : b);
    assert.ok(Math.abs(w.x0 - o.x0) < 3 && Math.abs(w.y0 - o.y0) < 3, `${w.text} at ${w.x0},${w.y0} not ${o.x0},${o.y0}`);
  }
});

test('a far-away photo is refused before reading', () => {
  const r = photoPage(asPhoto(kbankPageWords(), { scale: 0.6 }), { w: 400, h: 600 });
  assert.deepEqual([r.ok, r.code], [false, 'too-blurry']);
});

test('a photo of a bank with no layout on file is refused', () => {
  // An unknown bank: neither its name mark nor any known column headings.
  const headings = new Set(Object.values(PROFILES).flatMap(p => p.anchors.map(a => a.text)));
  const words = asPhoto(kbankPageWords()).filter(w => w.text !== 'KBPDF' && !headings.has(w.text));
  assert.deepEqual([photoPage(words, { w: 1600, h: 2200 }).ok, photoPage(words, { w: 1600, h: 2200 }).code], [false, 'unknown-layout']);
});

test('the whole chain: photo words -> readable PDF -> checked statement, yellow', async () => {
  const page = photoPage(asPhoto(kbankPageWords()), { w: 1600, h: 2200 });
  const pdf = buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words: page.words }]);
  const st = await readStatement('photo.pdf', pdf, [], null, pdfjs);
  assert.deepEqual(st.checks.filter(c => !c[1]), []);
  assert.equal(statusOf(st), 'yellow');
});

test('a one-digit misread in an amount is caught as red, never yellow', async () => {
  const words = asPhoto(kbankPageWords());
  const i = words.findIndex(w => w.text === '10,000.00');
  words[i] = { ...words[i], text: '10,000.80' };
  const page = photoPage(words, { w: 1600, h: 2200 });
  assert.ok(page.words.some(w => w.text === '10,000.80'));       // kept as read - not "corrected"
  const pdf = buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words: page.words }]);
  const st = await readStatement('photo.pdf', pdf, [], null, pdfjs);
  assert.equal(statusOf(st), 'red');
});

import { imageMatrix, pageSizeFor } from '../../src/photo/pipeline.js';

test('the visible photo is placed exactly under its hidden words', () => {
  const page = photoPage(asPhoto(kbankPageWords()), { w: 1600, h: 2200 });
  const m = imageMatrix(page.placement, 1600, 2200, 842);
  // Image pixel (x, y) -> unit square (x/W, 1 - y/H) -> page via the matrix.
  const onPage = ([x, y]) => { const u = x / 1600, v = 1 - y / 2200; return [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]; };
  const photoWords = asPhoto(kbankPageWords());
  for (const w of page.words) {
    // Map every same-text photo word onto the page; its own source must land on it.
    const landed = photoWords.filter(p => p.text === w.text).map(p => onPage([p.x0, p.y0]));
    assert.ok(landed.some(([X, Y]) => Math.abs(X - w.x0) < 0.5 && Math.abs((842 - Y) - w.y0) < 0.5),
      `${w.text} at ${w.x0},${w.y0}: photo lands at ${landed.map(([X, Y]) => `${X.toFixed(1)},${(842 - Y).toFixed(1)}`)}`);
  }
});

test('page size follows the bank: KTB Corporate is landscape', () => {
  assert.deepEqual(pageSizeFor('kbank'), { width: 595, height: 842 });
  assert.deepEqual(pageSizeFor('ktbcorp'), { width: 842, height: 595 });
});

test("a bank whose name was cut off is still recognised by its column headings", () => {
  const words = asPhoto(kbankPageWords()).filter(w => w.text !== 'KBPDF');
  const page = photoPage(words, { w: 1600, h: 2200 });
  assert.deepEqual([page.ok, page.bank], [true, 'kbank']);
});

import { separateWords } from '../../src/photo/pipeline.js';
import { readWords, Word } from '../../src/engine/words.js';

test('touching words are kept apart, so the readable PDF does not glue them', async () => {
  const touching = [new Word(300, 240, 333, 250, '12,345.67'), new Word(333.5, 240, 360, 250, 'เจ่ายบิล'),
    new Word(200, 240, 230, 250, '250.00')];
  const apart = separateWords(touching);
  const [page] = await readWords(buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words: apart }]), null, pdfjs);
  assert.deepEqual(page.map(w => w.text).sort(), ['12,345.67', '250.00', 'เจ่ายบิล'].sort());
  assert.ok(apart.find(w => w.text === '12,345.67').x1 <= 331.5);
});

import { levelLines } from '../../src/photo/pipeline.js';
import { groupIntoRows } from '../../src/engine/rows.js';

// Measured on a simulated KTB Corporate photo: the reader returned the period
// label in pieces of very different heights (a lone "ง" 1.2 pt tall). Written
// as they were, they came back from the readable PDF on two rows.
test('pieces of one printed line come back from the readable PDF as one row', async () => {
  const line = [new Word(16.8, 186.7, 26.4, 198.3, 'ราย'), new Word(28.4, 185.8, 56.8, 198.0, 'การระหว่า'),
    new Word(57.3, 189.7, 58.1, 190.9, 'ง'), new Word(60.5, 189.6, 61.7, 193.6, 'ว'),
    new Word(64.0, 185.2, 76.4, 197.1, 'ันที่'), new Word(116.6, 188.9, 197.9, 195.7, '04/2026,05/2026,06/2026')];
  const next = [new Word(22.6, 205.6, 37.3, 217.6, 'นทีขอ'), new Word(116.7, 209.3, 152.0, 214.9, '15/08/2026')];
  const words = separateWords(levelLines([...line, ...next]));
  const [page] = await readWords(buildReadablePdf([{ jpeg: TINY_JPEG, width: 842, height: 595, words }]), null, pdfjs);
  const rows = groupIntoRows(page);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, line.length);
});

// Measured on a simulated KTB Corporate photo: the photo step knew the bank
// from its column headings, but the bank's mark (an e-mail in the footer) was
// misread, so the checker fell back to the general reader and refused. The
// readable PDF now carries the bank the photo step found.
test('the bank found from the photo travels inside the readable PDF', async () => {
  const page = photoPage(asPhoto(kbankPageWords()).filter(w => w.text !== 'KBPDF'), { w: 1600, h: 2200 });
  const pdf = buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words: page.words }], { bank: page.bank });
  const st = await readStatement('photo.pdf', pdf, [], null, pdfjs);
  assert.equal(st.profile.key, 'kbank');
  assert.deepEqual(st.checks.filter(c => !c[1]), []);
  assert.equal(statusOf(st), 'yellow');
});

test('a bank mark only counts inside a PDF made from photos', async () => {
  const [page] = await readWords(buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842,
    words: [new Word(50, 50, 90, 60, 'hello')] }], { bank: 'kbank' }), null, pdfjs).then(p => [p]);
  assert.equal(page.bank, 'kbank');
  assert.throws(() => buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words: [] }], { bank: 'nope) /x' }));
});

// Measured 2026-10-07 on every bank's page 1 (clean, photo, small picture):
// true heading matches were 3-5; every wrong one was exactly 2 (KTB Corporate
// on a KTB page, UOB on KKP, KBank on SCB) - two points line up with any two
// points. Without the bank's own mark, a layout needs 3 headings.
test('two headings alone never decide the bank', () => {
  const keep = new Set(PROFILES.kbank.anchors.slice(0, 2).map(a => a.text));
  const words = asPhoto(kbankPageWords()).filter(w => w.text !== 'KBPDF'
    && !(PROFILES.kbank.anchors.some(a => a.text === w.text) && !keep.has(w.text)));
  const page = photoPage(words, { w: 1600, h: 2200 });
  assert.deepEqual([page.ok, page.code], [false, 'unknown-layout']);
});

import { uobSummaryWords, uobStatementWords } from './madeup.js';

// Co 2026-10-07: photo sets include UOB's summary page. A page with no column
// headings but the bank's summary mark is a SUMMARY page: kept for the period
// and account facts, never read for transactions.
test('a summary page is told apart from a statement page', () => {
  const summary = photoPage(asPhoto(uobSummaryWords()), { w: 1600, h: 2200 });
  assert.deepEqual([summary.ok, summary.summary, summary.bank], [true, true, 'uob']);
  const statement = photoPage(asPhoto(uobStatementWords()), { w: 1600, h: 2200 });
  assert.deepEqual([statement.ok, !!statement.summary, statement.bank], [true, false, 'uob']);
});

test('summary + statement photos: period from the summary, rows from the statement only', async () => {
  const pages = [uobSummaryWords(), uobStatementWords()].map(ws => photoPage(asPhoto(ws), { w: 1600, h: 2200 }));
  const pdf = buildReadablePdf(pages.map(p => ({ jpeg: TINY_JPEG, width: 595, height: 842, words: p.words })),
    { bank: 'uob', summaryPages: [0] });
  const st = await readStatement('photo.pdf', pdf, [], null, pdfjs);
  assert.deepEqual([st.facts.period_from, st.facts.period_to], ['01/09/2026', '30/09/2026']);
  assert.equal(st.rows.length, 4);
  assert.deepEqual(st.checks.filter(c => !c[1]), []);
  assert.equal(statusOf(st), 'yellow');
  // the statement page alone has no period: refused, as before
  const alone = buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words: pages[1].words }], { bank: 'uob' });
  await assert.rejects(readStatement('photo.pdf', alone, [], null, pdfjs), /period could not be read/);
});

test('summary pages alone are refused: no transactions to read', () => {
  assert.throws(() => buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words: [] }],
    { bank: 'uob', summaryPages: [0] }), /only summary/);
});

import { buildWorkbook } from '../../src/engine/output/review.js';

// Co 2026-10-07: "say where to check". A statement made from photos names the
// photo page of every row in its Review file, so a doubtful row can be found.
test('review file from photos: every row says which page it is on', async () => {
  const pages = [uobSummaryWords(), uobStatementWords()].map(ws => photoPage(asPhoto(ws), { w: 1600, h: 2200 }));
  const pdf = buildReadablePdf(pages.map(p => ({ jpeg: TINY_JPEG, width: 595, height: 842, words: p.words })),
    { bank: 'uob', summaryPages: [0] });
  const st = await readStatement('photo.pdf', pdf, [], null, pdfjs);
  const [tx] = buildWorkbook(st.rows, st.opening, st.closing, st.facts, st.checks, st.profile, st.name, st.fromPhoto);
  const head = tx.rows[0].map(c => c.value);
  assert.equal(head[head.length - 1], 'Photo page');
  assert.deepEqual(st.rows.map(r => r.page), [2, 2, 2, 2]);
  assert.equal(tx.rows[2][head.length - 1].value, 2);
});
