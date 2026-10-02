// Step 1 - get the words off the page, WITH their positions.
//
// pdf.js reports text as RUNS ("48,123.45 PROMPTPAY"), where the reference
// implementation (Poppler) reports single words. A run's outer edges are exact,
// so each run is split on its spaces and every word placed by weighted glyph
// width. Measured on a real statement: the boundary lands within 0.1pt of
// Poppler's. The oracle comparison is what proves it on every real file.
import { StatementError } from './errors.js';

export class Word {
  constructor(x0, y0, x1, y1, text) {
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.text = text;
  }
  get ycentre() { return (this.y0 + this.y1) / 2; }
}

// Bank statements space words wider than Helvetica's 278: measured on KKP
// (gap 4.5pt between '48,123.45' and 'PROMPTPAY'), 575 puts both edges and a
// Thai run's date edge within 1pt of Poppler.
const SPACE = 575;

// Relative glyph widths (Helvetica AFM, per 1000 em), ASCII 32..126. Only the
// RATIOS matter: every run is scaled to its exact measured width. Thai
// combining marks take no width; other Thai letters about 0.55 em.
const ASCII = [SPACE, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722,
  722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const THAI_ZERO = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;

function glyphWidth(ch) {
  const c = ch.codePointAt(0);
  if (c >= 32 && c <= 126) return ASCII[c - 32];
  if (c >= 0x0E00 && c <= 0x0E7F) return THAI_ZERO.test(ch) ? 0 : 550;
  return 556;
}

export function splitRun(str, x0, x1, y0, y1) {
  if (!str || !str.trim()) return [];
  const chars = [...str];
  const widths = chars.map(glyphWidth);
  const total = widths.reduce((a, b) => a + b, 0);
  if (!total) return [];
  const scale = (x1 - x0) / total;
  const out = [];
  let x = x0, start = null, text = '';
  chars.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (text) out.push(new Word(start, y0, x, y1, text));
      text = ''; start = null;
    } else {
      if (start === null) start = x;
      text += ch;
    }
    x += widths[i] * scale;
  });
  if (text) out.push(new Word(start, y0, x1, y1, text));
  return out;
}

// Place a run's words on the page the way Poppler measures them. A word's box
// runs from the font's ascent to its descent (not just the font size), and a
// rotated run - the KBPDF stamp prints sideways up the left margin - is laid
// along its own direction, so it is tall and narrow like Poppler's. `transform`
// is pdf.js's [a b c d e f]; `length` is the run's advance length; y is
// measured from the top of a `pageHeight` page.
export function placeRun(str, transform, length, ascent, descent, pageHeight) {
  const [a, b, c, d, e, f] = transform;
  const along = Math.hypot(a, b) || 1, size = Math.hypot(c, d);
  const ux = a / along, uy = b / along;                  // the reading direction
  const vx = c / (size || 1), vy = d / (size || 1);      // "up" for the glyphs
  return splitRun(str, 0, length, 0, 0).map(w => {
    const xs = [], ys = [];
    for (const o of [w.x0, w.x1]) {
      for (const h of [ascent * size, descent * size]) {
        xs.push(e + ux * o + vx * h);
        ys.push(pageHeight - (f + uy * o + vy * h));
      }
    }
    return new Word(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), w.text);
  });
}

// A PDF text string as pdf.js hands it over (one char per byte): UTF-16BE with
// a byte-order mark, UTF-8 with one, otherwise PDFDocEncoding - which matches
// Latin-1 for every letter a statement uses.
export function pdfText(raw) {
  if (raw.startsWith('\xFE\xFF')) {
    let s = '';
    for (let i = 2; i + 1 < raw.length; i += 2) s += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
    return s;
  }
  if (raw.startsWith('\xEF\xBB\xBF')) {
    return new TextDecoder().decode(Uint8Array.from(raw.slice(3), c => c.charCodeAt(0)));
  }
  return raw;
}

const isFlat = t => Math.abs(t[1]) < 1e-6 && Math.abs(t[2]) < 1e-6 && t[0] > 0;

// The glyphs inside an ActualText span, replaced by that text over the space
// they cover - how Poppler (the answer key) reads them. A span with nothing
// drawn still breaks the word.
function spanItem(span) {
  const drawn = span.items.filter(it => it.str);
  if (!drawn.length) return { gap: true };
  const [first] = drawn;
  const [a, b, , , e0, f0] = first.transform;
  const along = Math.hypot(a, b) || 1, ux = a / along, uy = b / along;
  let lo = Infinity, hi = -Infinity;
  for (const it of drawn) {
    const o = (it.transform[4] - e0) * ux + (it.transform[5] - f0) * uy;
    lo = Math.min(lo, o); hi = Math.max(hi, o + it.width);
  }
  const transform = [...first.transform];
  transform[4] = e0 + ux * lo; transform[5] = f0 + uy * lo;
  return { str: span.text, transform, width: hi - lo, fontName: first.fontName, actual: true };
}

// pdf.js text items (read with includeMarkedContent) -> plain text items, with
// every ActualText span's glyphs swapped for its text. Spans of one letter each
// (UOB's Thai) are joined back into words when they touch: same line, same
// size, the gap no wider than 0.1 of the font size - Poppler's word-break rule.
// Text outside any ActualText span passes through unchanged.
export function applyActualText(items) {
  const out = [], stack = [];
  const sink = () => stack.findLast(Boolean)?.items ?? out;
  for (const it of items) {
    if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') {
      stack.push(typeof it.actualText === 'string' ? { text: pdfText(it.actualText), items: [] } : null);
    } else if (it.type === 'endMarkedContent') {
      const span = stack.pop();
      if (span) sink().push(spanItem(span));
    } else if (it.type === undefined) {
      sink().push(it);
    }
  }
  while (stack.length) {                    // a span left open at the end of the page
    const span = stack.pop();
    if (span) sink().push(spanItem(span));
  }

  const joined = [];
  for (const it of out) {
    const prev = joined.at(-1);
    if (it.gap) { joined.push(it); continue; }
    if (prev?.actual && it.actual && isFlat(prev.transform) && isFlat(it.transform)) {
      const size = prev.transform[3];
      const end = prev.transform[4] + prev.width;
      const gap = it.transform[4] - end;
      if (Math.abs(it.transform[3] - size) < 0.01 && Math.abs(it.transform[5] - prev.transform[5]) <= 0.5
          && it.transform[4] >= prev.transform[4] && gap <= 0.1 * size) {
        prev.str += it.str;
        prev.width = Math.max(end, it.transform[4] + it.width) - prev.transform[4];
        continue;
      }
    }
    joined.push(it.actual ? { ...it } : it);
  }
  return joined.filter(it => !it.gap);
}

// Some Thai fonts (KTB Corporate) have glyphs with no real character: tone
// marks come out as Latin letters ("É" for ่, "Ê" for ้) and some digits as
// "řŘŠ...". The reference reader (Poppler) drops them - a word break for a
// tone mark - so do the same, and both read "เครื องรับ..." identically.
export function cleanGlyphs(str) {
  return str
    .replace(/(?<=[฀-๿])[À-ÿ]|[À-ÿ](?=[฀-๿])/g, ' ')
    .replace(/[Ā-ſ]/g, '');
}

// [a b c d e f] matrices, pdf.js order: multiply(m1, m2) applies m2 first.
export function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

// The viewport maps the page to the screen as shown (turned, y down); flip y
// back up so placeRun can measure the upright page like any other.
export function uprightMatrix(viewportTransform, height) {
  return multiply([1, 0, 0, -1, 0, height], viewportTransform);
}

// One array of words per page, y measured from the top of the page.
// `pdfjs` is the imported pdf.js module, injected so that Node tests and the
// browser share this code.
export async function readWords(bytes, password, pdfjs) {
  // pdf.js 6: the LOADING TASK owns the worker and is what gets destroyed.
  const task = pdfjs.getDocument({
    data: bytes, password: password ?? undefined, verbosity: 0, isEvalSupported: false,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    if (e?.name === 'PasswordException') {
      throw password
        ? new StatementError('the password is not right', 'wrong-password')
        : new StatementError('this file is locked', 'locked');
    }
    throw new StatementError('this is not a PDF that can be opened', 'not-pdf');
  }
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const height = viewport.height;
      // A page saved sideways (/Rotate 90 or 270) is shown upright by every
      // viewer, but its text is stored in the unturned page's coordinates:
      // each transaction would come out as a column instead of a row. Turn
      // the text the same way the viewer turns the page.
      const turn = page.rotate % 360 ? uprightMatrix(viewport.transform, height) : null;
      // Marked content only adds markers: pdf.js splits its text at every span
      // either way, so pages without ActualText read exactly as before.
      const content = await page.getTextContent({ includeMarkedContent: true });
      const words = [];
      for (const it of applyActualText(content.items)) {
        if (!it.str || !it.str.trim()) continue;
        const str = cleanGlyphs(it.str);
        if (!str.trim()) continue;
        const style = content.styles[it.fontName] ?? {};
        words.push(...placeRun(str, turn ? multiply(turn, it.transform) : it.transform, it.width,
          style.ascent ?? 0.95, style.descent ?? -0.35, height));
      }
      pages.push(words);
    }
    if (!pages.some(p => p.length)) {
      throw new StatementError('no text found - this PDF is pictures only', 'no-text');
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
