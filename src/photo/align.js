// Put photo words where the bank's own PDF puts them, so the unchanged engine
// can read columns by position (2026-10-02: KBank at 85% scale = FAIL
// without this).
import { Word } from '../engine/words.js';

const TOLERANCE_PT = 4;

// The reader drops Thai tone marks and vowels above/below the line more than
// anything else ("ชองทาง" for "ช่องทาง"), so headings are compared without them.
const bare = s => s.normalize('NFC').replace(/[\p{M}\s]/gu, '');

// Every word, plus runs of up to 4 touching words on one line: the reader
// splits a heading into pieces ("ยอด" "ค" "งเหลือ", "วันที่" "/" "เว" "ลา").
// "Touching" is measured by the taller of the two pieces: a Thai word with
// nothing above or below the line is less than half as tall as its neighbour.
// A run sits where its first piece starts.
function headingCandidates(words) {
  const out = words.map(w => ({ text: bare(w.text), first: w }));
  for (const w of words) {
    let run = [w];
    for (let k = 1; k < 4; k++) {
      const last = run[run.length - 1];
      const h = n => Math.max(last.y1 - last.y0, n.y1 - n.y0);
      const next = words.filter(n => !run.includes(n)
        && Math.abs((n.y0 + n.y1) / 2 - (last.y0 + last.y1) / 2) < 0.3 * h(n)
        && n.x0 - last.x1 > -0.2 * h(n) && n.x0 - last.x1 < 0.5 * h(n))
        .sort((a, b) => a.x0 - b.x0)[0];
      if (!next) break;
      run = [...run, next];
      out.push({ text: run.map(r => bare(r.text)).join(''), first: w });
    }
  }
  return out;
}

// Scale and shift from the bank's column headings found in the photo. Each
// heading must be read exactly once; at least 2 must be found, and every one
// found must land within TOLERANCE_PT of where the bank prints it.
export function fitAnchors(words, anchors) {
  const candidates = headingCandidates(words);
  const pairs = [];
  for (const a of anchors) {
    const hits = [...new Set(candidates.filter(c => c.text === bare(a.text)).map(c => c.first))];
    if (hits.length === 1) pairs.push([hits[0], a]);
  }
  if (pairs.length < 2) return null;
  // Scale from the widest-apart pair, shift from the mean of all pairs.
  let best = null;
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const span = Math.hypot(pairs[i][1].x0 - pairs[j][1].x0, pairs[i][1].y0 - pairs[j][1].y0);
    if (!best || span > best.span) best = { i, j, span };
  }
  const [[pa], [pb]] = [pairs[best.i], pairs[best.j]];
  const scale = best.span / Math.hypot(pa.x0 - pb.x0, pa.y0 - pb.y0);
  const dx = pairs.reduce((s, [p, a]) => s + (a.x0 - p.x0 * scale), 0) / pairs.length;
  const dy = pairs.reduce((s, [p, a]) => s + (a.y0 - p.y0 * scale), 0) / pairs.length;
  for (const [p, a] of pairs) {
    if (Math.abs(p.x0 * scale + dx - a.x0) > TOLERANCE_PT || Math.abs(p.y0 * scale + dy - a.y0) > TOLERANCE_PT) return null;
  }
  return { scale, dx, dy, matched: pairs.length };
}

export function placeWords(words, { scale, dx, dy }) {
  return words.map(w => new Word(w.x0 * scale + dx, w.y0 * scale + dy, w.x1 * scale + dx, w.y1 * scale + dy, w.text));
}

export function alignPage(words, profile) {
  const fit = profile?.anchors ? fitAnchors(words, profile.anchors) : null;
  return fit ? { words: placeWords(words, fit), fit } : { refused: 'unknown-layout' };
}
