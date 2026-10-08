// A made-up passbook page, printed from the stored dot patterns: every figure
// here is invented. Each symbol is stamped at the printer's box width, so the
// reader sees the same dots it would on a scan.
import { KTB_PASSBOOK } from '../../src/passbook/printers/ktb.js';
import { CW, CH } from '../../src/passbook/reader.js';

const PITCH = KTB_PASSBOOK.ratio * KTB_PASSBOOK.lineHeight;
const firstOf = {};
for (const p of KTB_PASSBOOK.patterns) firstOf[p.ch] ??= p;

// Darkness 0..210 back to grey (ink dark, paper 255); overlapping boxes keep the darker.
function stamp(img, ch, x, top) {
  const p = firstOf[ch];
  if (!p) return;
  // the box's middle only: its edges hold slivers of the neighbours it was cut from
  for (let y = 0; y < CH; y++) for (let k = 2; k < CW - 2; k++) {
    const X = Math.round(x) + k, Y = top + y;
    if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
    const grey = 255 - Math.min(255, p.f[y * CW + k] * 1.2);
    const i = Y * img.w + X;
    if (grey < img.px[i]) img.px[i] = grey;
  }
}
function text(img, s, x, top) { [...s].forEach((ch, k) => stamp(img, ch, x + k * PITCH, top)); }
const rightAligned = (img, s, x1, top) => text(img, s, x1 - s.length * PITCH, top);

/** lines: [{ date, amount?, balance }] -> a grey page like a 200 dpi scan */
export function madeUpPage(lines) {
  const img = { w: 1654, h: 300 + lines.length * 38, px: new Uint8Array(1654 * (300 + lines.length * 38)).fill(255) };
  lines.forEach((l, i) => {
    const top = 200 + i * 38;
    text(img, l.date, 680, top);
    text(img, '876', 790, top);
    if (l.amount) rightAligned(img, l.amount, l.amount.startsWith('-') ? 1140 : 1258, top);
    rightAligned(img, l.balance, 1528, top);
    text(img, '000014', 1550, top);
  });
  return img;
}
