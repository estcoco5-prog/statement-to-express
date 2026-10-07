// Refuse a photo early rather than produce a wall of misreads.
// Digit height in the photo's own pixels. Was 12; with the reading copy
// enlarged (below), a 1280 px chat-app picture (digits ~7-8 px) reads right -
// KTB Corporate 11/11, the rest refused or caught by the checks, none wrong.
// Unreadable pictures are still stopped by MIN_CONFIDENCE.
export const MIN_TEXT_PX = 6;
export const MIN_CONFIDENCE = 55;   // median tesseract confidence of the words it kept

// The reading copy is enlarged before the reader sees it: on KTB Corporate at
// 200 dpi, read as-is 2 balances were misread and 4 amounts missed over 3
// pages; at 1.5x or 2x all 36 rows were proved and matched the PDF. Small
// pictures need more (up to 4x) to reach the same print size. Word boxes
// are divided back by the same factor, so every size check above stays in
// the photo's own pixels.
export const READ_LONG_EDGE = 3500;
export const MAX_READ_SCALE = 4;
export function readScale(w, h) {
  return Math.min(MAX_READ_SCALE, Math.max(1, READ_LONG_EDGE / Math.max(w, h)));
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const RETAKE = 'Take the photo closer, of the PAPER statement, flat and bright, filling the frame. ' +
  'Never photograph a screen - ask the client for the bank PDF instead. / ' +
  'ถ่ายใกล้ขึ้น ถ่ายจากกระดาษ วางราบ สว่าง เต็มกรอบ ห้ามถ่ายจากหน้าจอ';

// Words with a digit are the ones that matter (dates, money): measure those.
export function checkSharpness(words) {
  const sized = words.filter(w => /\d/.test(w.text));
  if (sized.length < 10) return { ok: false, medianHeight: null, reason: RETAKE };
  const h = median(sized.map(w => w.y1 - w.y0));
  const conf = median(sized.map(w => w.conf));
  const ok = h >= MIN_TEXT_PX && conf >= MIN_CONFIDENCE;
  return { ok, medianHeight: h, reason: ok ? null : RETAKE };
}
