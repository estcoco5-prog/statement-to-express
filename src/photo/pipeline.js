// OCR words (photo pixels) -> engine words (PDF points). Pure: no browser.
import { checkSharpness } from './quality.js';
import { tidyWords, readingOrder, cleanEdges, joinThai } from './tidy.js';
import { Word } from '../engine/words.js';
import { alignPage } from './align.js';
import { deskewAngle, rotatePoint } from './geometry.js';
import { identify, columnOf, PROFILES } from '../engine/profiles.js';
import { fitAnchors } from './align.js';

const NO_HEADINGS = "Could not find this bank's column headings in the photo. / หาหัวคอลัมน์ของธนาคารในรูปไม่พบ";
const NO_LAYOUT = 'This bank has no layout on file yet. / ธนาคารนี้ยังไม่มีรูปแบบในระบบ';

// Two headings line up with ANY two points, so they prove nothing: measured on
// every bank's page 1, true matches were 3-5 headings and every wrong one was
// exactly 2 (KTB Corporate on a KTB page). The third is the independent check.
const MIN_HEADINGS_TO_NAME_BANK = 3;
function byHeadings(words) {
  const fits = Object.values(PROFILES).map(p => [p, fitAnchors(words, p.anchors ?? [])])
    .filter(([, f]) => f && f.matched >= MIN_HEADINGS_TO_NAME_BANK);
  if (!fits.length) return null;
  fits.sort((a, b) => b[1].matched - a[1].matched);
  return fits.length > 1 && fits[1][1].matched === fits[0][1].matched ? null : fits[0][0];
}

export function photoPage(ocrWords, { w, h }) {
  const sharp = checkSharpness(ocrWords);
  if (!sharp.ok) return { ok: false, code: 'too-blurry', reason: sharp.reason };

  // Straighten from confidently read words only (confidence >= 80). The tilt
  // comes from how tightly word centres gather into rows, so no word is paired
  // with another - the 2026-10-02 failure was pairing dates with balances.
  const sure = ocrWords.filter(x => x.conf >= 80);
  // Rows are told apart in bins a quarter of the print height: a fixed 2 px
  // bin missed a 1.5-degree tilt on a 200-dpi photo (measured: 2 px -> -0.05,
  // 4 px -> 1.4).
  const binPx = Math.max(2, sharp.medianHeight / 4);
  const tilt = deskewAngle(sure.map(x => [(x.x0 + x.x1) / 2, (x.y0 + x.y1) / 2]), 5, binPx) ?? 0;
  const centre = [w / 2, h / 2];
  const straight = ocrWords.map(x => {
    const [x0, y0] = rotatePoint([x.x0, x.y0], -tilt, centre);
    return { ...x, x0, y0, x1: x0 + (x.x1 - x.x0), y1: y0 + (x.y1 - x.y0) };
  });

  // The bank's name mark first; if the reader lost it (cut off, misread),
  // the bank whose column headings fit the page - alone, never a tie.
  const profile = identify(straight.map(x => x.text).join(' ')) ?? byHeadings(joinThai(cleanEdges(straight)));
  // No table headings but a bank's summary mark: a summary page (Co
  // 2026-10-07: UOB sets include it). Kept for the period and account facts.
  const summaryOf = () => summaryPage(straight, { w, tilt, centre });
  if (!profile) return summaryOf() ?? { ok: false, code: 'unknown-layout', reason: NO_LAYOUT };
  // Money repair needs columns and columns need the line-up: line up once on
  // the raw words, find which words sit in money columns, tidy, line up again.
  // Stray table-line characters ("|Channel") would hide the headings.
  const first = alignPage(joinThai(cleanEdges(straight)), profile);
  if (first.refused) return summaryOf() ?? { ok: false, code: 'unknown-layout', reason: NO_HEADINGS };
  const { scale, dx } = first.fit;
  const inMoney = x => ['amount', 'balance'].includes(columnOf(profile, x.x0 * scale + dx, x.x1 * scale + dx));
  const inDate = x => columnOf(profile, x.x0 * scale + dx, x.x1 * scale + dx) === 'date';
  const aligned = alignPage(tidyWords(straight, inMoney, inDate), profile);
  if (aligned.refused) return { ok: false, code: 'unknown-layout', reason: NO_HEADINGS };
  const { scale: s, dx: sx, dy: sy } = aligned.fit;
  return { ok: true, words: separateWords(levelLines(aligned.words)), bank: profile.key, tiltDeg: tilt,
    placement: { tilt, centre, scale: s, dx: sx, dy: sy } };
}

// A page whose text carries a bank's summary mark (spaces ignored, as the
// reader splits words). With no headings to line it up by, the photo is
// scaled to the page width - its words are only read for header facts.
function summaryPage(straight, { w, tilt, centre }) {
  const text = straight.map(x => x.text).join('').replace(/\s+/g, '');
  const profile = Object.values(PROFILES).find(p => (p.marks.summary_page ?? [])
    .some(m => text.includes(m.replace(/\s+/g, ''))));
  if (!profile) return null;
  const scale = pageSizeFor(profile.key).width / w;
  const words = straight.map(x => ({ ...x, x0: x.x0 * scale, y0: x.y0 * scale, x1: x.x1 * scale, y1: x.y1 * scale }));
  return { ok: true, summary: true, words: separateWords(levelLines(joinThai(cleanEdges(words)))), bank: profile.key,
    tiltDeg: tilt, placement: { tilt, centre, scale, dx: 0, dy: 0 } };
}

// The reader's boxes for one printed line differ in height (a lone Thai
// letter can be 1 pt tall, a word with tone marks 12 pt), and the readable PDF
// sets each word at its own box - so one line came back as two rows (measured
// on a KTB Corporate photo). Every word of a line gets the line's middle top
// and bottom. Lines are told apart the way readingOrder does.
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
export function levelLines(words) {
  const mid = w => (w.y0 + w.y1) / 2;
  const h = median(words.map(w => w.y1 - w.y0)) || 1;
  const lines = [];
  for (const w of [...words].sort((a, b) => mid(a) - mid(b))) {
    const line = lines[lines.length - 1];
    if (line && mid(w) - line.centre < 0.6 * h) {
      line.words.push(w);
      line.centre = line.words.reduce((s, x) => s + mid(x), 0) / line.words.length;
    } else lines.push({ centre: mid(w), words: [w] });
  }
  return lines.flatMap(({ words: ws }) => {
    const y0 = median(ws.map(w => w.y0)), y1 = median(ws.map(w => w.y1));
    return ws.map(w => ({ x0: w.x0, x1: w.x1, text: w.text, y0, y1 }));
  });
}

// Printed words never touch, but the reader's boxes can. In the readable PDF
// two words less than 1.5 pt apart are read back as ONE word (measured with
// pdf.js), so trim the left word's end to leave at least MIN_GAP_PT.
const MIN_GAP_PT = 2;
export function separateWords(words) {
  const out = readingOrder(words).map(w => new Word(w.x0, w.y0, w.x1, w.y1, w.text));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    const sameLine = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < (b.y1 - b.y0) / 2;
    if (sameLine && b.x0 > a.x0 && b.x0 - a.x1 < MIN_GAP_PT) {
      out[i - 1] = new Word(a.x0, a.y0, Math.max(a.x0 + (a.x1 - a.x0) * 0.5, b.x0 - MIN_GAP_PT), a.y1, a.text);
    }
  }
  return out;
}

// The page each bank prints on, in points (KTB Corporate is landscape).
export function pageSizeFor(bankKey) {
  return bankKey === 'ktbcorp' ? { width: 842, height: 595 } : { width: 595, height: 842 };
}

// Where the photo goes on the page so that it sits exactly under its words:
// the same turn, scale and shift the words were given, as the PDF matrix that
// maps the image's unit square onto the page (y up). imgW/imgH = the photo's
// pixel size. Pixel (x, y) is unit point (x/W, 1 - y/H).
export function imageMatrix({ tilt, centre: [cx, cy], scale: s, dx, dy }, imgW, imgH, pageHeight) {
  const r = -tilt * Math.PI / 180, C = Math.cos(r), S = Math.sin(r);
  return [
    s * imgW * C, -s * imgW * S,
    s * imgH * S, s * imgH * C,
    s * (cx - cx * C - (imgH - cy) * S) + dx,
    pageHeight - (s * (cy - cx * S + (imgH - cy) * C) + dy),
  ];
}
