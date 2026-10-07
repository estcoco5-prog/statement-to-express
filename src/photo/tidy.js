// Make tesseract's words look like a PDF's words.
const THAI = /^[฀-๿]+$/;

// Reading order: lines top to bottom, each left to right. Letters on one line
// have very different boxes (a tall ว starts higher than a short น), so lines
// are found by vertical centre first - sorting by top edge scrambles them.
export function readingOrder(words) {
  const mid = w => (w.y0 + w.y1) / 2;
  const heights = words.map(w => w.y1 - w.y0).sort((a, b) => a - b);
  const h = heights[Math.floor(heights.length / 2)] || 1;
  const lines = [];
  for (const w of [...words].sort((a, b) => mid(a) - mid(b))) {
    const line = lines[lines.length - 1];
    if (line && mid(w) - line.centre < 0.6 * h) {
      line.words.push(w);
      line.centre = line.words.reduce((s, x) => s + mid(x), 0) / line.words.length;
    } else lines.push({ centre: mid(w), words: [w] });
  }
  return lines.flatMap(l => l.words.sort((a, b) => a.x0 - b.x0));
}

// Tesseract returns Thai one letter at a time: glue touching Thai pieces on
// the same line back into words (gap under a third of the text height).
export function joinThai(words) {
  const out = [];
  for (const w of readingOrder(words)) {
    const prev = out[out.length - 1];
    const sameLine = prev && Math.abs((prev.y0 + prev.y1) / 2 - (w.y0 + w.y1) / 2) < (w.y1 - w.y0) / 2;
    const gap = prev ? w.x0 - prev.x1 : null;
    const h = Math.max(w.y1 - w.y0, prev ? prev.y1 - prev.y0 : 0);
    // A vowel or tone mark sits ON the letter before it, so it overlaps it.
    const mark = prev && /^\p{M}+$/u.test(w.text) && (w.x0 + w.x1) / 2 >= prev.x0 - 0.2 * h
      && (w.x0 + w.x1) / 2 <= prev.x1 + 0.2 * h;
    const sameRow = prev && Math.abs((prev.y0 + prev.y1) / 2 - (w.y0 + w.y1) / 2) < h;
    if (prev && THAI.test(prev.text) && THAI.test(w.text) && ((mark && sameRow)
        || (sameLine && gap > -0.2 * h && gap < 0.35 * h))) {   // just after it, not behind it
      out[out.length - 1] = { ...prev, text: prev.text + w.text, x1: w.x1,
        y0: Math.min(prev.y0, w.y0), y1: Math.max(prev.y1, w.y1), conf: Math.min(prev.conf, w.conf) };
    } else out.push({ ...w });
  }
  return out;
}

const group3 = digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// '01710725' (slashes read as 7) or '01/1025' (the second slash lost) -> a
// date, only if the result is a real day and month. Measured on BBL photos,
// where each lost date dropped a row and broke the balance chain after it.
// Only shapes where the day is certain: '1710/25' (really 01/10/25, a 0 lost
// and a slash read as 7) would rebuild as a real but WRONG 17/10/25 - so a
// lost first slash, or both, is left as read. Anything else gives null.
const DATE_SHAPE = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/;
const SLASH_LOOKALIKE = '71/|lI-';
const realDate = (d, m, y, sep) => Number(d) >= 1 && Number(d) <= 31 && Number(m) >= 1 && Number(m) <= 12
  ? `${d}${sep}${m}${sep}${y}` : null;
export function repairDate(text) {
  if (DATE_SHAPE.test(text)) return text;
  if (!/^[\d/|lI-]{6,10}$/.test(text)) return null;
  const sep = text.includes('-') ? '-' : '/';
  // Separators read as look-alike characters, in their usual places.
  if ((text.length === 8 || text.length === 10) && SLASH_LOOKALIKE.includes(text[2]) && SLASH_LOOKALIKE.includes(text[5])) {
    const d = text.slice(0, 2), m = text.slice(3, 5), y = text.slice(6);
    if (/^\d+$/.test(d + m + y)) { const r = realDate(d, m, y, sep); if (r) return r; }
  }
  // The second separator lost, the day and the first one intact: dd/mmyy(yy).
  const second = /^(\d{2})[-/](\d{2})(\d{2}|\d{4})$/.exec(text);
  return second ? realDate(second[1], second[2], second[3], sep) : null;
}

// '1.234.56' (commas read as dots) and '5432109' (punctuation lost) -> money.
// Anything else - a date above all - gives null.
export function repairMoney(text) {
  if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(text)) return text;
  if (/^\d{1,3}(\.\d{3})+\.\d{2}$/.test(text)) {
    const parts = text.split('.'); const cents = parts.pop();
    return `${group3(parts.join(''))}.${cents}`;
  }
  if (/^\d{3,12}$/.test(text)) return `${group3(text.slice(0, -2))}.${text.slice(-2)}`;
  return null;
}

// Only words the caller says sit in an amount/balance column are repaired:
// the balance check then proves or rejects a repaired figure. Everything
// else, dates above all, passes through exactly as read.
export function tidyWords(words, isMoneyColumn, isDateColumn = () => false) {
  return joinSplitMoney(joinThai(cleanEdges(words)), isMoneyColumn).map(w => {
    const fixed = isMoneyColumn(w) ? repairMoney(w.text) : isDateColumn(w) ? repairDate(w.text) : null;
    return fixed ? { ...w, text: fixed } : w;
  });
}

// Table rule lines read as characters: "|17:30", "(13:38", a lone "|".
// Stripped from the edges of a word only; a word that was nothing else goes.
const EDGE = /^[|()[\]“”"'‘’]+|[|()[\]“”"'‘’]+$/g;
export function cleanEdges(words) {
  const out = [];
  for (const w of words) {
    // A rule read INSIDE a word ("10,203.04|PrompiPay") splits it; each part
    // keeps its share of the box, by character count.
    const n = [...w.text].length || 1, per = (w.x1 - w.x0) / n;
    let at = 0;
    for (const part of w.text.split('|')) {
      const len = [...part].length;
      const text = part.replace(EDGE, '');
      if (text) out.push({ ...w, text, x0: w.x0 + at * per, x1: w.x0 + (at + len) * per });
      at += len + 1;
    }
  }
  return out;
}

// "12,304 .86": an amount the reader split at a stray space. In a money
// column, digits followed closely by ".dd" are one amount - and the balance
// check then proves or rejects it.
export function joinSplitMoney(words, isMoneyColumn) {
  const out = [];
  for (const w of readingOrder(words)) {
    const prev = out[out.length - 1];
    const h = w.y1 - w.y0;
    if (prev && /^\.\d{2}$/.test(w.text) && /^[\d,]+$/.test(prev.text) && isMoneyColumn(prev)
        && Math.abs((prev.y0 + prev.y1) / 2 - (w.y0 + w.y1) / 2) < h / 2 && w.x0 - prev.x1 < 0.6 * h) {
      out[out.length - 1] = { ...prev, text: prev.text + w.text, x1: w.x1, conf: Math.min(prev.conf, w.conf) };
    } else out.push({ ...w });
  }
  return out;
}
