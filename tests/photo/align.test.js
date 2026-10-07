import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitAnchors, placeWords, alignPage } from '../../src/photo/align.js';

const anchors = [{ text: 'Date', x0: 40, y0: 200 }, { text: 'Balance', x0: 480, y0: 200 }, { text: 'Withdrawal', x0: 300, y0: 200 }];
// The same header photographed at 2.5 px per point, shifted by (30, 55) px.
const px = (x, y) => [x * 2.5 + 30, y * 2.5 + 55];
const word = (text, x, y, wpt = 30) => { const [a, b] = px(x, y), [c, d] = px(x + wpt, y + 10); return { text, x0: a, y0: b, x1: c, y1: d, conf: 90 }; };

test('two or more anchors give the scale and shift back exactly', () => {
  const words = [word('Date', 40, 200), word('Balance', 480, 200), word('Withdrawal', 300, 200), word('1,000.00', 300, 230)];
  const fit = fitAnchors(words, anchors);
  assert.ok(Math.abs(fit.scale - 0.4) < 1e-6);
  const placed = placeWords(words, fit);
  assert.ok(Math.abs(placed[3].x0 - 300) < 1e-6 && Math.abs(placed[3].y0 - 230) < 1e-6);
});

test('a page with fewer than 2 anchors is refused, not guessed', () => {
  assert.equal(fitAnchors([word('Date', 40, 200)], anchors), null);
  assert.deepEqual(alignPage([word('Hello', 10, 10)], { anchors }), { refused: 'unknown-layout' });
});

test('anchors that disagree (one misread in the wrong place) are refused', () => {
  const words = [word('Date', 40, 200), word('Balance', 480, 200), word('Withdrawal', 100, 260)];
  assert.equal(fitAnchors(words, anchors), null);
});

// Measured 2026-10-03 on a 200-dpi KBank page: the reader dropped tone marks
// and vowels above the line ("ชองทาง", "รายละเอยด") and split a heading into
// touching pieces ("ยอด" "ค" "งเหลือ").
const thai = [{ text: 'ช่องทาง', x0: 100, y0: 200 }, { text: 'ยอดคงเหลือ', x0: 300, y0: 200 }, { text: 'รายละเอียด', x0: 450, y0: 200 }];

test('a Thai heading read without its tone mark or upper vowel still matches', () => {
  const fit = fitAnchors([word('ชองทาง', 100, 200), word('รายละเอยด', 450, 200)], thai);
  assert.equal(fit?.matched, 2);
});

test('a heading split into touching pieces on one line still matches, at the first piece', () => {
  const words = [word('ช่องทาง', 100, 200), word('ยอด', 300, 200, 14), word('ค', 314.5, 200, 5), word('งเหลือ', 320, 200, 25)];
  const fit = fitAnchors(words, thai);
  assert.equal(fit?.matched, 2);
  assert.ok(Math.abs(fit.scale - 0.4) < 1e-6);
});

test('pieces far apart, or on different lines, are not joined into a heading', () => {
  assert.equal(fitAnchors([word('ช่องทาง', 100, 200), word('ยอด', 300, 200, 14), word('คงเหลือ', 360, 200)], thai), null);
  assert.equal(fitAnchors([word('ช่องทาง', 100, 200), word('ยอด', 300, 200, 14), word('คงเหลือ', 314.5, 215)], thai), null);
});

test('a short piece next to a tall one joins by the taller height; four pieces join', () => {
  // KTB 2026-10-03: "ยอด" is 4.3 pt tall (no marks above or below), "เงินคงเหลือ" 10.8 pt, 2.2 pt apart.
  const box = (text, x0, y0, x1, y1) => { const [a, b] = px(x0, y0), [c, d] = px(x1, y1); return { text, x0: a, y0: b, x1: c, y1: d, conf: 90 }; };
  const words = [box('ยอด', 471.2, 236.2, 482.0, 240.5), box('เงินคงเหลือ', 484.2, 233.3, 514.1, 244.1),
    box('วันที่', 40, 231.8, 54.7, 244.1), box('/', 56.5, 236.5, 56.9, 240.5), box('เว', 57.6, 236.5, 64, 240.5), box('ลา', 64.4, 231.8, 72.4, 244.1)];
  const fit = fitAnchors(words, [{ text: 'วันที่/เวลา', x0: 40, y0: 231.8 }, { text: 'ยอดเงินคงเหลือ', x0: 471.2, y0: 236.2 }]);
  assert.equal(fit?.matched, 2);
});
