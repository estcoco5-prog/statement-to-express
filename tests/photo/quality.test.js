import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSharpness, MIN_TEXT_PX } from '../../src/photo/quality.js';

const w = (h, conf = 90) => ({ text: '1,000.00', x0: 0, y0: 0, x1: 40, y1: h, conf });

test('small, far-away text is refused before any reading is trusted', () => {
  assert.equal(checkSharpness(Array(30).fill(w(MIN_TEXT_PX + 4))).ok, true);
  const far = checkSharpness(Array(30).fill(w(5)));       // TMB sample picture: digits 4.5-5.5 px
  assert.equal(far.ok, false);
  assert.match(far.reason, /closer/);
  assert.equal(checkSharpness([]).ok, false);                                   // nothing read at all
  assert.equal(checkSharpness(Array(30).fill(w(30, 20))).ok, false);            // a screen photo: tall but unreadable
});

import { readScale } from '../../src/photo/quality.js';

// Measured on KTB Corporate, 3 pages at 200 dpi: read as-is, 2 balances were
// misread (5 -> 6, 9 -> 8) and 4 amounts missed; enlarged 1.5x or 2x before
// reading, 36 of 36 rows were proved and every one matched the PDF.
test('the reading copy is enlarged toward a 3500 px long edge, at most 4x', () => {
  assert.equal(readScale(1654, 2339), 3500 / 2339);     // a 200-dpi A4 scan: ~1.5x
  assert.equal(readScale(776, 1024), 3500 / 1024);       // a small picture, as a chat app sends it
  assert.equal(readScale(400, 600), 4);                  // tiny: capped
  assert.equal(readScale(2400, 3200), 3500 / 3200);      // a phone photo, already large
  assert.equal(readScale(3000, 4000), 1);                // never shrunk
});
