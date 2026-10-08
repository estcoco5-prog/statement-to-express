// The passbook reader. A passbook is printed by a dot-matrix printer: every
// character sits in a box of the same width, and every "3" is the same dots
// every time. So instead of a general text reader (which reads dotted digits
// badly), each line is cut into equal boxes and each box is matched against
// the printer's stored dot patterns. The money it reads is NOT trusted here:
// the engine proves every row with the balance chain afterwards.
//
// Pure JavaScript, browser and Node alike. Input: a grey picture where ink is
// dark - the darkest of red, green and blue per pixel, so the passbook's cyan
// print and background fade away and only the black ribbon is left.

// One box as the matcher sees it: CW x CH pixels at the printer's measured line
// height, with PAD pixels around it so a pattern can slide a little.
export const CW = 11, CH = 36, PAD = 3;
const SLIDE_X = 2;
const WW = CW + 2 * PAD, WH = CH + 2 * PAD, N = CW * CH;

// ---- pictures ------------------------------------------------------------------

// RGBA (a canvas) -> grey, ink dark.
export function greyFromRGBA(data, w, h) {
  const px = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < px.length; i++, j += 4) {
    const r = data[j], g = data[j + 1], b = data[j + 2];
    px[i] = r > g ? (r > b ? r : b) : (g > b ? g : b);
  }
  return { w, h, px };
}

// Resize by k (bilinear): a photo or scan at another size is brought to the
// line height the printer's patterns were measured at.
export function resample(img, k) {
  const w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.h - 1.001, Math.max(0, (y + 0.5) / k - 0.5)), y0 = Math.floor(sy), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.w - 1.001, Math.max(0, (x + 0.5) / k - 0.5)), x0 = Math.floor(sx), fx = sx - x0;
      const i = y0 * img.w + x0;
      const top = img.px[i] * (1 - fx) + img.px[i + 1] * fx;
      const bot = img.px[i + img.w] * (1 - fx) + img.px[i + img.w + 1] * fx;
      px[y * w + x] = Math.round(top * (1 - fy) + bot * fy);
    }
  }
  return { w, h, px };
}

// ---- finding the printed lines and the character boxes -----------------------

// Ink, then ink grown by one pixel so the separate dots of one character join.
function inkGrown({ w, h, px }, inkBelow) {
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = px[i] < inkBelow ? 1 : 0;
  const grown = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    grown[i] = ink[i] | ink[i - 1] | ink[i + 1] | ink[i - w] | ink[i + w];
  }
  return grown;
}

function blobs(grown, w, h) {
  const seen = new Uint8Array(w * h), out = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!grown[s] || seen[s]) continue;
    let top = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && grown[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && grown[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && grown[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && grown[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    out.push({ x0, y0, x1, y1, n });
  }
  return out;
}

// A printed line: character-sized blobs at one height. A real passbook line has
// a date, a code, a balance and a staff id - a dozen characters at least.
function printedLines(bl) {
  const chars = bl.filter(c => c.y1 - c.y0 >= 14 && c.y1 - c.y0 <= 40 && c.x1 - c.x0 <= 40)
    .sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const lines = [];
  for (const c of chars) {
    const cy = (c.y0 + c.y1) / 2;
    const L = lines.find(l => Math.abs(l.cy - cy) < 10);
    if (L) { L.items.push(c); L.sum += cy; L.cy = L.sum / L.items.length; } else lines.push({ cy, sum: cy, items: [c] });
  }
  for (const L of lines) {
    const hs = L.items.map(c => c.y1 - c.y0).sort((a, b) => a - b);
    L.hgt = hs[hs.length >> 1];
    L.top = Math.round(L.cy - L.hgt / 2);
  }
  return lines.filter(L => L.items.length >= 12).sort((a, b) => a.cy - b.cy);
}

// Everything printed on the line (small marks too: ".", ",", "*", "-"), cut
// into groups wherever the gap is wider than about half a character.
function groupsOn(L, bl) {
  const band0 = L.top - Math.round(L.hgt * 0.45), band1 = L.top + Math.round(L.hgt * 1.35);
  const marks = bl.filter(c => c.y0 >= band0 && c.y1 <= band1 && c.x1 - c.x0 <= 160 && c.n >= 6)
    .map(c => ({ ...c })).sort((a, b) => a.x0 - b.x0);
  const merged = [];
  for (const c of marks) {
    const p = merged[merged.length - 1];
    if (p && c.x0 <= p.x1 - 1 && Math.min(p.x1, c.x1) - Math.max(p.x0, c.x0) >= 0.5 * Math.min(p.x1 - p.x0, c.x1 - c.x0)) {
      p.x0 = Math.min(p.x0, c.x0); p.x1 = Math.max(p.x1, c.x1); p.y0 = Math.min(p.y0, c.y0); p.y1 = Math.max(p.y1, c.y1);
    } else merged.push(c);
  }
  const groups = [];
  for (const m of merged) {
    const g = groups[groups.length - 1];
    if (g && m.x0 - g.x1 <= L.hgt * 0.55) g.x1 = Math.max(g.x1, m.x1); else groups.push({ x0: m.x0, x1: m.x1 });
  }
  return groups;
}

// The box width. A group 82 px wide is 8 boxes of 10.25 or 9 of 9.1 - only
// the printer's own width:height ratio tells which, so the search stays near it.
function pitchOf(groups, hgt, ratio) {
  const widths = groups.map(g => g.x1 - g.x0 + 1).filter(w => w >= 25);
  let best = null;
  for (let p = ratio * hgt * 0.93; p <= ratio * hgt * 1.07; p += 0.02) {
    let err = 0;
    for (const w of widths) { const n = (w + 2) / p; err += Math.abs(n - Math.round(n)); }
    if (!best || err < best.err - 1e-9) best = { p, err };
  }
  return best ? best.p : ratio * hgt;
}

function boxes(group, pitch) {
  const w = group.x1 - group.x0 + 1, n = Math.round((w + 2) / pitch);
  if (n < 1) return [];
  const p = (w + 2) / n;
  return Array.from({ length: n }, (_, k) => ({ x0: Math.round(group.x0 - 1 + k * p), x1: Math.round(group.x0 - 1 + (k + 1) * p) - 1 }));
}

// One box's darkness picture with its slide margin, and - for every slide -
// the sums the match needs, worked out once per box rather than per pattern.
function boxPicture(box, L, img) {
  const top = Math.round(L.top - L.hgt * 0.35), cx = Math.round((box.x0 + box.x1) / 2);
  const f = new Float32Array(WW * WH);
  for (let y = 0; y < WH; y++) {
    const Y = top - PAD + y;
    for (let x = 0; x < WW; x++) {
      const X = cx - (CW >> 1) - PAD + x;
      const v = X >= 0 && Y >= 0 && X < img.w && Y < img.h ? img.px[Y * img.w + X] : 255;
      f[y * WW + x] = v < 210 ? 210 - v : 0;
    }
  }
  let m = 0, mx = 0, my = 0;
  // the box's own columns only: the margin holds the neighbours' ink
  for (let y = 0; y < WH; y++) for (let x = PAD; x < PAD + CW; x++) { const v = f[y * WW + x]; m += v; mx += v * x; my += v * y; }
  const slides = [];
  for (let dy = -PAD; dy <= PAD; dy++) for (let dx = -SLIDE_X; dx <= SLIDE_X; dx++) {
    let sb = 0, sbb = 0;
    for (let y = 0; y < CH; y++) {
      const r = (y + PAD + dy) * WW + PAD + dx;
      for (let x = 0; x < CW; x++) { const B = f[r + x]; sb += B; sbb += B * B; }
    }
    slides.push({ dx, dy, off: PAD + dy, offX: PAD + dx, sb, vb: sbb - sb * sb / N });
  }
  return { f, slides, x0: box.x0, x1: box.x1, cx: m ? mx / m : WW / 2, cy: m ? my / m : WH / 2 };
}

// ---- patterns -------------------------------------------------------------------

export function makePattern(ch, values) {
  const f = values instanceof Float32Array ? values : Float32Array.from(values);
  let sa = 0, saa = 0, mx = 0, my = 0;
  for (let i = 0; i < N; i++) { const v = f[i]; sa += v; saa += v * v; mx += v * (i % CW); my += v * Math.floor(i / CW); }
  return { ch, f, sa, va: saa - sa * sa / N, cx: sa ? mx / sa : CW / 2, cy: sa ? my / sa : CH / 2 };
}
// A box's own centre as a pattern (learning from a proved row).
export function patternFromBox(ch, box) {
  const f = new Float32Array(N);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) f[y * CW + x] = box.f[(y + PAD) * WW + PAD + x];
  return makePattern(ch, f);
}
export function decodePatterns(stored) {
  const out = [];
  for (const [ch, list] of Object.entries(stored)) {
    for (const b64 of list) {
      const bin = atob(b64);
      const f = new Float32Array(N);
      for (let i = 0; i < N; i++) f[i] = bin.charCodeAt(i);
      out.push(makePattern(ch, f));
    }
  }
  return out;
}
export function encodePattern(p) {
  let s = '';
  for (let i = 0; i < N; i++) s += String.fromCharCode(Math.max(0, Math.min(255, Math.round(p.f[i]))));
  return btoa(s);
}

// How well each symbol fits the box: the best correlation of any of its
// patterns, over the slides. 1 is a perfect fit.
function fit(box, patterns) {
  const best = {};
  for (const t of patterns) {
    if (t.va <= 0) continue;
    let r = -1;
    // Slide only around where the ink lines up (the two centres of darkness),
    // one pixel either way - not across every position.
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    const ex = clamp(Math.round(box.cx - PAD - t.cx), SLIDE_X), ey = clamp(Math.round(box.cy - PAD - t.cy), PAD);
    for (const s of box.slides) {
      if (s.vb <= 0 || Math.abs(s.dx - ex) > 1 || Math.abs(s.dy - ey) > 1) continue;
      let sab = 0;
      const f = box.f, tf = t.f;
      for (let y = 0; y < CH; y++) {
        const rb = (y + s.off) * WW + s.offX, ra = y * CW;
        for (let x = 0; x < CW; x++) sab += tf[ra + x] * f[rb + x];
      }
      const v = (sab - t.sa * s.sb / N) / Math.sqrt(t.va * s.vb);
      if (v > r) r = v;
    }
    if (!(best[t.ch] >= r)) best[t.ch] = r;
  }
  return best;
}

const DIGITS = '0123456789';
function pick(fits, allowed) {
  let a = null, b = null;
  for (const ch of allowed) {
    const v = fits[ch] ?? -1;
    if (!a || v > a.r) { b = a; a = { ch, r: v }; } else if (!b || v > b.r) b = { ch, r: v };
  }
  return { ch: a.ch, r: a.r, margin: a.r - (b ? b.r : -1) };
}
const freeRead = fits => pick(fits, Object.keys(fits)).ch;

// What the printer can put at each place. Money: a sign, digits with a comma
// every 3, ".", two digits - so only some lengths exist (8 and 12 never do).
// Dates: dd/mm/yy. The reader only chooses among those, as a person would.
export function moneyShape(n) {
  let d = 1;
  while (1 + d + Math.floor((d - 1) / 3) + 3 < n) d++;
  if (1 + d + Math.floor((d - 1) / 3) + 3 !== n) return null;
  return Array.from({ length: n }, (_, k) => {
    const fromRight = n - 1 - k;
    if (k === 0) return '+-*';
    if (fromRight <= 1) return DIGITS;
    if (fromRight === 2) return '.';
    return fromRight >= 6 && (fromRight - 6) % 4 === 0 ? ',' : DIGITS;
  });
}
const DATE_SHAPE = [DIGITS, DIGITS, '/', DIGITS, DIGITS, '/', DIGITS, DIGITS];

// One group of boxes -> a date, a figure, or something else (a code, a staff id).
function readGroup(group, patterns) {
  const n = group.length;
  const fits = i => (group[i].fits ??= fit(group[i], patterns));
  // Cheap look first: only a group with "." or "," third from the end can be
  // money, and only 8-10 boxes can be a date - letters are never matched in full.
  // "Could this be one of these?" - close to the best fit, not only the best.
  const near = (f, chars) => {
    const top = Math.max(...Object.values(f));
    return [...chars].some(ch => (f[ch] ?? -1) >= top - 0.08);
  };
  if (n >= 4 && near(fits(n - 3), '.,')) {
    const first = freeRead(fits(0));
    if (n >= 5 && near(fits(0), '+-*')) {
      const shape = moneyShape(n);
      if (!shape) return { kind: 'bad', boxes: group };
      const read = group.map((b, k) => pick(fits(k), shape[k]));
      const text = read.map(c => c.ch).join('');
      if (/^[+\-*]0\d/.test(text)) return { kind: 'bad', boxes: group };
      return { kind: 'money', text, read, boxes: group };
    }
    else if (DIGITS.includes(first)) {
      // a balance whose "*" was not printed clearly enough to be found
      const shape = moneyShape(n + 1);
      if (shape) {
        const read = group.map((b, k) => pick(fits(k), shape[k + 1]));
        const text = '*' + read.map(c => c.ch).join('');
        if (!/^\*0\d/.test(text)) return { kind: 'money', unsigned: true, text, read, boxes: group, offset: 1 };
      }
    }
  }
  if (n >= 8 && n <= 10) {
    // the 8 boxes that best fit dd/mm/yy (a speck at the page edge can add one)
    let best = null;
    for (let o = 0; o + 8 <= n; o++) {
      const score = (fits(o + 2)['/'] ?? -1) + (fits(o + 5)['/'] ?? -1);
      if (!best || score > best.score) best = { o, score };
    }
    if (best.score > 1.0) {
      const sub = group.slice(best.o, best.o + 8);
      const read = sub.map((b, k) => pick(fits(best.o + k), DATE_SHAPE[k]));
      return { kind: 'date', text: read.map(c => c.ch).join(''), read, boxes: sub };
    }
  }
  return { kind: 'other', boxes: group };
}

// ---- a page, a passbook ---------------------------------------------------------

// Cut one page into lines of box groups. The picture is first brought to the
// printer's line height so the stored patterns fit.
export function cutPage(img, printer) {
  let bl = blobs(inkGrown(img, printer.inkBelow), img.w, img.h);
  let lines = printedLines(bl);
  if (lines.length) {
    const hgt = lines.map(l => l.hgt).sort((a, b) => a - b)[lines.length >> 1];
    if (Math.abs(hgt - printer.lineHeight) > 1.5) {
      img = resample(img, printer.lineHeight / hgt);
      bl = blobs(inkGrown(img, printer.inkBelow), img.w, img.h);
      lines = printedLines(bl);
    }
  }
  const raw = lines.map(L => ({ L, groups: groupsOn(L, bl) }));
  const hgt = lines.length ? lines.map(l => l.hgt).sort((a, b) => a - b)[lines.length >> 1] : printer.lineHeight;
  const pitch = pitchOf(raw.flatMap(r => r.groups), hgt, printer.ratio);
  return raw.map(({ L, groups }) => ({
    y: L.top, groups: groups.map(g => boxes(g, pitch).map(b => boxPicture(b, L, img))).filter(g => g.length),
  }));
}

// One line -> what it says. A lone "*", "+" or "-" printed a little apart
// belongs to the figure after it.
export function readLine(line, patterns) {
  const groups = line.groups.slice();
  for (let k = 0; k + 1 < groups.length; k++) {
    if (groups[k].length !== 1) continue;
    const ch = freeRead(groups[k][0].fits ??= fit(groups[k][0], patterns));
    const gap = groups[k + 1][0].x0 - groups[k][0].x1, width = groups[k][0].x1 - groups[k][0].x0 + 1;
    if ('*+-'.includes(ch) && gap < 2.5 * width) groups.splice(k, 2, [...groups[k], ...groups[k + 1]]);
  }
  const read = groups.map(g => readGroup(g, patterns));
  const date = read.find(r => r.kind === 'date') ?? null;
  const balance = read.find(r => r.kind === 'money' && r.text.startsWith('*') && !r.unsigned)
    ?? read.filter(r => r.unsigned).pop() ?? null;
  const amount = read.find(r => r.kind === 'money' && /^[+-]/.test(r.text)) ?? null;
  const unsure = [date, amount, balance].filter(Boolean).flatMap(r => r.read).filter(c => c.margin < 0.03).length;
  return { date, amount, balance, unsure, garbled: read.some(r => r.kind === 'bad') };
}

export const cents = text => {
  const m = /^[+\-*]?([\d,]+)\.(\d\d)$/.exec(text ?? '');
  return m ? Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]) : null;
};
const signed = text => (text[0] === '-' ? -1 : 1) * cents(text);

// Rows whose amount and balance the chain proves (the rows above and below
// chaining too) teach the reader: their boxes are certainly those symbols. Used only to
// learn - the engine proves everything again on its own.
function provedLines(lines) {
  let prev = null;
  const chained = lines.map((l, i) => {
    const b = l.balance ? cents(l.balance.text) : null;
    const ok = i === 0 ? b !== null && !l.amount
      : prev !== null && b !== null && l.amount !== null && prev + signed(l.amount.text) === b;
    if (b !== null) prev = b;
    return ok;
  });
  // proved on both sides: the line above (whose balance this one builds on)
  // and the line below (which confirms this balance) chain too
  return lines.filter((l, i) => chained[i] && (i === 0 || chained[i - 1]) && (i + 1 === lines.length || chained[i + 1]));
}

const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * Read a whole passbook: every page in order, then once more with what the
 * proved rows taught. Returns one entry per printed line.
 * @param {{w,h,px}[]} pictures grey pages, ink dark
 */
export async function readPassbook(pictures, printer, onProgress = () => {}) {
  const patterns = printer.patterns.slice();
  const pages = [];
  for (const [i, img] of pictures.entries()) {
    onProgress({ step: 'cut', page: i + 1, pages: pictures.length });
    await tick();
    pages.push(cutPage(img, printer));
  }
  const readAll = async pass => {
    const out = [];
    for (const [p, lines] of pages.entries()) {
      for (const [n, line] of lines.entries()) {
        if (n % 4 === 0) { onProgress({ step: pass, page: p + 1, pages: pages.length }); await tick(); }
        out.push({ page: p + 1, line: n + 1, ...readLine(line, patterns) });
      }
    }
    return out;
  };
  let lines = await readAll('read');
  const per = {};
  for (const t of patterns) per[t.ch] = (per[t.ch] ?? 0) + 1;
  let learned = 0;
  // Learn the least familiar looks first (a lighter ribbon, a worn pin), from
  // anywhere in the book, until each symbol has its share.
  const candidates = [];
  for (const l of provedLines(lines)) {
    for (const r of [l.amount, l.balance]) {
      if (!r) continue;
      r.boxes.forEach((box, k) => {
        const ch = r.text[k + (r.offset ?? 0)];
        candidates.push({ ch, box, known: box.fits?.[ch] ?? -1 });
      });
    }
  }
  candidates.sort((x, y) => x.known - y.known);
  for (const { ch, box, known } of candidates) {
    if (known >= 0.9 || (per[ch] ?? 0) >= printer.maxPatterns) continue;
    per[ch] = (per[ch] ?? 0) + 1;
    patterns.push(patternFromBox(ch, box));
    learned++;
  }
  if (learned) {
    for (const lines2 of pages) for (const line of lines2) for (const g of line.groups) for (const b of g) b.fits = undefined;
    lines = await readAll('reread');
  }
  return lines.map(({ page, line, date, amount, balance, unsure, garbled }) => ({
    page, line, unsure, garbled,
    dateMargin: date ? Math.min(...date.read.map(c => c.margin)) : null,
    date: date?.text ?? null, amount: amount?.text ?? null, balance: balance?.text ?? null,
  }));
}
