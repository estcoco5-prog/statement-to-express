// A statement picture -> a table, the way a person would copy it into Excel.
// Pure: words in (from the photo reader, in photo pixels), rows of cells out.
// No bank layout is needed - the columns are found from the picture itself:
//
//   balance  of the groups of money words sharing a right edge (money is
//            printed right-aligned), the one whose lines carry dates
//   money    every other right-edge group with figures on those lines
//   date     date-shaped words grouped by their LEFT edge (time the same)
//   text     whatever sits between those columns, split again wherever no
//            line has any text (a gutter)
//   heading  the line(s) above the table whose cells name the most columns
//            (วันที่, ถอน, คงเหลือ, Date, Balance ...)
//
// Lines above the heading and below the table (bank name, address, page
// footer) are kept apart as "other text", never mixed into the table.
// Nothing here is trusted: the balance chain (table/statement.js) checks it.
import { checkSharpness } from '../photo/quality.js';
import { deskewAngle, rotatePoint } from '../photo/geometry.js';
import { cleanEdges, joinThai, joinSplitMoney, readingOrder, repairMoney, repairDate } from '../photo/tidy.js';
import { roleOf } from '../table/columns.js';
import { identify } from '../engine/profiles.js';

const MONEY = /^[-+(]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?(?:-|dr|cr)?$/i;
const MONEY_LOOSE = /^[-+(]?[\d,.]*\d[.,]\d{2}\)?-?$/;                 // before repair
const DATE = /^\d{1,2}[-/.]\d{1,2}[-/.](?:\d{2}|\d{4})$/;
// a time has a colon: "5.00" is money, not five o'clock
const TIME = /^\d{1,2}:\d{2}(?::\d{2})?$/;
// Thai banks' names as printed on their statements (spaces ignored): every
// Thai bank prints dates day first, as every one of our bank PDFs does.
const THAI_BANKS = ['KASIKORNBANK', 'กสิกรไทย', 'KRUNGTHAI', 'กรุงไทย', 'SIAMCOMMERCIAL', 'ไทยพาณิชย์', 'BANGKOKBANK',
  'ธนาคารกรุงเทพ', 'KIATNAKIN', 'เกียรตินาคิน', 'UNITEDOVERSEASBANK', 'ยูโอบี', 'KRUNGSRI', 'กรุงศรี', 'TTB', 'ทหารไทยธนชาต',
  'GOVERNMENTSAVINGS', 'ออมสิน', 'ธ.ก.ส', 'LANDANDHOUSES', 'แลนด์แอนด์เฮ้าส์', 'CIMBTHAI', 'ซีไอเอ็มบี', 'TISCO', 'ทิสโก้'];
const AMOUNT_NAMES = ['Amount', 'Amount (2nd column)', 'Amount (3rd column)'];
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// "1,234.56(Shop": a figure read together with the word after it. Split
// it, sharing the box by letters; anything else is left as read.
// (Marks first, then the split.)
// Stray marks stuck to a figure by a noisy photo ("8,765.43!", "2,345.67;")
// are dropped from figures only: words with letters are left as read.
const STRAY = /^[!;:}{|']+|[!;:}{|']+$/g;
function splitGlued(words) {
  return words.map(x => (/^[!;:}{|']*[\d,.]*\d[.,]\d{2}[!;:}{|']+$|^[!;:}{|']+[\d,.]*\d[.,]\d{2}$/.test(x.text)
    ? { ...x, text: x.text.replace(STRAY, '') } : x)).flatMap(x => {
    const m = /^([-+]?\d{1,3}(?:,\d{3})*\.\d{2})([(A-Za-z฀-๿].*)$/.exec(x.text);   // a letter or ( after: not a date "11.02-26"
    if (!m) return [x];
    const cut = x.x0 + (x.x1 - x.x0) * m[1].length / x.text.length;
    return [{ ...x, text: m[1], x1: cut }, { ...x, text: m[2].replace(/^[(]/, ''), x0: cut }];
  });
}

// Passbook print (and other dot-printed pages): a balance is printed with a
// star in front ("*1,234.56" - the printer's mark, not part of the figure),
// and a faint "+" in front of money in is read as "$" or "#". Figures only.
// A big figure the dots split at its comma ("-120," then "000.00", side by
// side on one line) is put back together.
const PRINTED = /^[*$#]([-+]?[\d,]*\d\.\d{2})$/;
function passbookMarks(words) {
  // A page where most figures carry the "$" is in dollars: there it is the
  // currency, dropped without a "+" (G8 review N1).
  const figures = words.filter(x => /^[^\d\s]?[-+]?[\d,]*\d\.\d{2}$/.test(x.text));
  const dollars = figures.filter(x => /^\$/.test(x.text)).length > 0.5 * figures.length;
  const out = [];
  for (const x of words.map(x => {
    const m = PRINTED.exec(x.text);
    const plus = x.text[0] !== '*' && !(x.text[0] === '$' && dollars) && !/^[-+]/.test(m?.[1] ?? '');
    return m ? { ...x, text: plus ? `+${m[1]}` : m[1] } : x;
  })) {
    const prev = out[out.length - 1];
    const h = x.y1 - x.y0;
    if (prev && /^[-+]?\d{1,3}(?:,\d{3})*,$/.test(prev.text) && /^\d{3}\.\d{2}$/.test(x.text)
        && Math.abs((prev.y0 + prev.y1) / 2 - (x.y0 + x.y1) / 2) < h / 2 && x.x0 - prev.x1 >= 0 && x.x0 - prev.x1 < 1.5 * h) {
      out[out.length - 1] = { ...prev, text: prev.text + x.text, x1: x.x1, conf: Math.min(prev.conf, x.conf) };
    } else out.push(x);
  }
  return out;
}

// A date whose separators were lost ("1503/25", "150325") is put back as
// dd/mm/yy only when it then falls in order between the readable dates above
// and below it: "1903/25" between two 01/03/25 lines was 01/03/25 misread, and
// is left as read (one line to check) rather than made a wrong date that holds
// the lines after it.
function fixLostSeparators(rows, dc) {
  if (dc < 0) return;
  const key = t => {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/.exec(t ?? '');
    if (!m) return null;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3] > 2400 ? +m[3] - 543 : +m[3];
    return y * 10000 + +m[2] * 100 + +m[1];
  };
  const lost = t => {
    const m = /^(\d{2})(\d{2})[-/.]?(\d{2}|\d{4})$/.exec(t ?? '');
    return m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}/${m[2]}/${m[3]}` : null;
  };
  const read = rows.map(r => key(r[dc]));
  rows.forEach((r, i) => {
    if (i === 0 || read[i] !== null) return;
    const fixed = lost(String(r[dc] ?? '').trim());
    if (!fixed) return;
    const before = read.slice(1, i).filter(v => v !== null).at(-1);
    const after = read.slice(i + 1).find(v => v !== null);
    const k = key(fixed);
    if ((before !== undefined || after !== undefined) && (before === undefined || before <= k) && (after === undefined || k <= after)) r[dc] = fixed;
  });
}

/** Words on the same printed line, top to bottom, each line left to right. */
export function linesOf(words, h) {
  const mid = w => (w.y0 + w.y1) / 2;
  const lines = [];
  for (const w of [...words].sort((a, b) => mid(a) - mid(b))) {
    const line = lines[lines.length - 1];
    if (line && mid(w) - line.y < 0.6 * h) {
      line.words.push(w);
      line.y = line.words.reduce((s, x) => s + mid(x), 0) / line.words.length;
    } else lines.push({ y: mid(w), words: [w] });
  }
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0);
  return lines;
}

// Items -> groups along one axis, a new group wherever the gap is wider than `gap`.
function groups(items, at, gap) {
  const out = [];
  for (const it of [...items].sort((a, b) => at(a) - at(b))) {
    const g = out[out.length - 1];
    if (g && at(it) - at(g[g.length - 1]) <= gap) g.push(it); else out.push([it]);
  }
  return out;
}

/**
 * @param ocrWords [{ text, x0, y0, x1, y1, conf }] in photo pixels
 * @returns {{ ok: true, rows: string[][], other: string[], columns: number, tilt: number, headingFound: boolean }
 *          | { ok: false, code, reason }}
 */
export function pictureTable(ocrWords, { w, h }) {
  const sharp = checkSharpness(ocrWords);
  if (!sharp.ok) return { ok: false, code: 'too-blurry', reason: sharp.reason };
  const ch = sharp.medianHeight;

  // Straighten, as the photos card does: from confidently read words only.
  const sure = ocrWords.filter(x => x.conf >= 80);
  const tilt = deskewAngle(sure.map(x => [(x.x0 + x.x1) / 2, (x.y0 + x.y1) / 2]), 5, Math.max(2, ch / 4)) ?? 0;
  const centre = [w / 2, h / 2];
  const straight = ocrWords.map(x => {
    const [x0, y0] = rotatePoint([x.x0, x.y0], -tilt, centre);
    return { ...x, x0, y0, x1: x0 + (x.x1 - x.x0), y1: y0 + (x.y1 - x.y0) };
  });
  let words = splitGlued(passbookMarks(readingOrder(joinThai(cleanEdges(straight)))));
  const near = (x, c) => Math.abs(x.x1 - c.right) <= 2 * ch;
  const moneyish = x => MONEY.test(x.text) || (MONEY_LOOSE.test(x.text) && !!repairMoney(x.text.replace(/^[-+(]|[)-]$/g, '')));
  const dateish = x => DATE.test(x.text) || !!repairDate(x.text);

  // 1. The balance column: of the groups of money words sharing a right edge,
  // the one whose lines carry dates (a summary box of totals has none).
  let lines = linesOf(words, ch);
  const lineOf = new Map(lines.flatMap((l, i) => l.words.map(x => [x, i])));
  const datedLine = new Set(lines.flatMap((l, i) => (l.words.some(dateish) ? [i] : [])));
  const clusters = groups(lines.flatMap(l => l.words.filter(moneyish)), x => x.x1, 1.5 * ch);
  const scored = clusters.map(g => ({ g, dated: g.filter(x => datedLine.has(lineOf.get(x))).length }))
    .sort((p, q) => q.dated - p.dated || q.g.length - p.g.length || median(q.g.map(x => x.x1)) - median(p.g.map(x => x.x1)));
  // Two money columns on as many dated lines (SCB: Debit/Credit, Balance):
  // the balance is the one whose change from line to line is an amount
  // printed on the same line. Asked of the near-equal leaders only.
  const cents = x => { const t = x.text.replace(/[^\d.]/g, ''); return /^\d+\.\d{2}$/.test(t) ? Math.round(+t * 100) : null; };
  const chain = g => {
    const byLine = new Map();
    for (const x of g) if (!byLine.has(lineOf.get(x)) && cents(x) !== null) byLine.set(lineOf.get(x), cents(x));
    const seq = [...byLine].sort((p, q) => p[0] - q[0]);
    let hits = 0;
    for (let k = 1; k < seq.length; k++) {
      const moved = Math.abs(seq[k][1] - seq[k - 1][1]);
      const others = lines[seq[k][0]].words.filter(x => moneyish(x) && !g.includes(x)).map(cents);
      if (moved && others.includes(moved)) hits++;
    }
    return hits;
  };
  if (scored.length > 1 && scored[1].dated >= 0.8 * scored[0].dated) {
    const leaders = scored.filter(c => c.dated >= 0.8 * scored[0].dated).map(c => ({ ...c, chain: chain(c.g) }));
    const top = leaders.reduce((p, q) => (q.chain > p.chain ? q : p));
    if (top.chain > leaders[0].chain) scored.splice(scored.indexOf(scored.find(c => c.g === top.g)), 1), scored.unshift(top);
  }
  const best = scored[0];
  if (!best || best.g.length < 2) return { ok: false, code: 'no-table', reason: 'no column of amounts was found in this picture' };
  const balanceLines = [...new Set(best.g.map(x => lineOf.get(x)))].sort((p, q) => p - q);
  const first = balanceLines[0], lastBal = balanceLines[balanceLines.length - 1];
  const inRange = x => { const i = lineOf.get(x); return i >= first && i <= lastBal; };

  // 2. Every money column with figures among those lines (one figure is
  // enough: a short statement may have a single withdrawal), mostly inside them.
  const moneyCols = clusters
    .map(g => ({ g, inside: g.filter(inRange) }))
    .filter(({ g, inside }) => inside.length && inside.length >= g.length / 2)
    .map(({ g, inside }) => ({ kind: 'money', right: median(inside.map(x => x.x1)), left: Math.min(...inside.map(x => x.x0)),
      n: inside.length, balance: g === best.g }));

  // Repair money only inside a money column (the balance proves or rejects it).
  // by position: the words below are new objects (joinSplitMoney copies them)
  const yTop = lines[first].y - ch, yBottom = lines[lastBal].y + ch;
  const inMoney = x => (x.y0 + x.y1) / 2 >= yTop && (x.y0 + x.y1) / 2 <= yBottom && moneyCols.some(c => near(x, c));
  words = joinSplitMoney(words, inMoney).map(x => {
    if (!inMoney(x) || MONEY.test(x.text)) return x;
    const m = /^([-+(]?)(.*?)([)-]?)$/.exec(x.text);
    // "3.20000": the comma read as a dot and the decimal point lost -> 3,200.00
    const lost = /^(\d{1,3})[.,](\d{3})(\d{2})$/.exec(m[2]);
    const fixed = lost ? `${lost[1]},${lost[2]}.${lost[3]}` : repairMoney(m[2]);
    return fixed ? { ...x, text: m[1] + fixed + m[3] } : x;
  });
  const balY0 = lines[first].y, balY1 = lines[lastBal].y;
  lines = linesOf(words, ch);
  const isMoneyIn = x => MONEY.test(x.text) && moneyCols.some(c => near(x, c));
  const bodyIdx = lines.map((l, i) => (l.y >= balY0 - ch && l.y <= balY1 + ch && l.words.some(isMoneyIn) ? i : -1)).filter(i => i >= 0);
  if (bodyIdx.length < 2) return { ok: false, code: 'no-table', reason: 'fewer than 2 lines with amounts were found' };
  const top = bodyIdx[0];
  const spacing = median(bodyIdx.slice(1).map((v, k) => lines[v].y - lines[bodyIdx[k]].y)) || 2 * ch;
  let last = bodyIdx[bodyIdx.length - 1];
  while (last + 1 < lines.length && lines[last + 1].y - lines[last].y < 1.6 * Math.min(spacing, 3 * ch)) last++;
  const body = lines.slice(top, last + 1);

  // 3. Date and time columns: left edges, on a good share of the table's lines.
  const anchored = (test, kind) => {
    const hits = body.flatMap(l => l.words.filter(test));
    const g = groups(hits, x => x.x0, 2 * ch).sort((p, q) => q.length - p.length)[0];
    return g && g.length >= Math.max(1, 0.3 * bodyIdx.length)
      ? { kind, left: median(g.map(x => x.x0)), right: Math.max(...g.map(x => x.x1)), n: g.length } : null;
  };
  const dateCol = anchored(dateish, 'date');
  // A time printed UNDER its date (same column) stays with the date.
  const timeFound = anchored(x => TIME.test(x.text), 'time');
  const timeCol = timeFound && !(dateCol && timeFound.left < dateCol.right && timeFound.right > dateCol.left) ? timeFound : null;
  const inDate = x => dateCol && x.x0 >= dateCol.left - 2 * ch && x.x1 <= dateCol.right + ch;
  for (const l of lines) l.words = l.words.map(x => (inDate(x) && !DATE.test(x.text) && repairDate(x.text) ? { ...x, text: repairDate(x.text) } : x));

  // 4. Text columns: between the anchored columns, split wherever no line of
  // the table has text across a gap wider than a character or so.
  const anchors = [...(dateCol ? [dateCol] : []), ...(timeCol ? [timeCol] : []), ...moneyCols];
  const anchorOf = x => {
    if (MONEY.test(x.text)) { const c = moneyCols.find(c => near(x, c)); if (c) return c; }
    if (dateCol && DATE.test(x.text) && inDate(x)) return dateCol;
    if (timeCol && TIME.test(x.text) && x.x0 >= timeCol.left - ch && x.x1 <= timeCol.right + ch) return timeCol;
    return null;
  };
  const covered = [];
  // Words lying across a money or date column (a long "BALANCE BROUGHT FORWARD")
  // would bridge the gutters: they are placed later, not used to find them.
  const crosses = x => anchors.some(c => x.x1 > c.left && x.x0 < c.right);
  for (const [a, b] of body.flatMap(l => l.words.filter(x => !anchorOf(x) && !crosses(x)).map(x => [x.x0, x.x1])).sort((p, q) => p[0] - q[0])) {
    const c = covered[covered.length - 1];
    if (c && a <= c[1] + 1.2 * ch) c[1] = Math.max(c[1], b); else covered.push([a, b]);
  }
  const textCols = covered.map(([a, b]) => ({ kind: 'text', left: a, right: b }))
    .filter(t => !anchors.some(c => t.left >= c.left - ch && t.right <= c.right + ch));
  const columns = [...anchors, ...textCols].sort((a, b) => (a.left + a.right) / 2 - (b.left + b.right) / 2);
  const columnFor = x => {
    const a = anchorOf(x);
    if (a) return columns.indexOf(a);
    const cx = (x.x0 + x.x1) / 2;
    // Words go into a money or date column only when they look like money or
    // a date: "BROUGHT FORWARD" lying across the amounts is text.
    const fits = c => c.kind === 'text' || (c.kind === 'money' ? MONEY_LOOSE.test(x.text) : /\d/.test(x.text));
    const allowed = columns.some(c => c.kind === 'text' && fits(c)) ? fits : () => true;
    let k = 0, dist = Infinity;
    columns.forEach((c, j) => {
      if (!allowed(c)) return;
      const d = cx < c.left ? c.left - cx : cx > c.right ? cx - c.right : 0;
      if (d < dist) { dist = d; k = j; }
    });
    return k;
  };
  const cellsOf = ls => {
    const cells = columns.map(() => []);
    for (const l of ls) for (const x of l.words) cells[columnFor(x)].push(x.text);
    return cells.map(c => c.join(' '));
  };
  // A heading word is not where the figures are (money is right-aligned, a
  // heading often centred): it goes to the column whose share of the line -
  // up to halfway to its neighbours - it overlaps most.
  const zones = columns.map((c, k) => [k ? (columns[k - 1].right + c.left) / 2 : -Infinity,
    k + 1 < columns.length ? (c.right + columns[k + 1].left) / 2 : Infinity]);
  const headingCellsOf = ls => {
    const cells = columns.map(() => []);
    for (const l of ls) for (const x of l.words) {
      let k = 0, most = -1;
      zones.forEach(([a, b], j) => { const o = Math.min(b, x.x1) - Math.max(a, x.x0); if (o > most) { most = o; k = j; } });
      cells[k].push(x.text);
    }
    return cells.map(c => c.join(' '));
  };

  // 5. The heading: within a few lines above the table, the line - or two
  // lines, for a heading printed on two - whose cells name the most columns.
  // Matched per cell, so Thai read letter by letter still counts.
  let header = null;
  const scoreOf = cells => new Set(cells.map(roleOf).filter(Boolean)).size;
  for (let i = Math.max(0, top - 6); i < top; i++) {
    const pairs = [[lines[i]], ...(i + 1 < top && lines[i + 1].y - lines[i].y < 2.2 * ch ? [[lines[i], lines[i + 1]]] : [])];
    for (const ls of pairs) {
      const cells = headingCellsOf(ls), score = scoreOf(cells);
      if (score >= 2 && (!header || score > header.score)) header = { at: i, n: ls.length, cells, score };
    }
  }
  // No heading read: name the columns by what they hold. Which amount column
  // is withdrawals is NOT guessed - the running balance decides direction.
  const others = moneyCols.filter(c => !c.balance);
  const headRow = header ? header.cells : columns.map((c, k) => (c === dateCol ? 'Date' : c === timeCol ? 'Time'
    : c.balance ? 'Balance' : c.kind === 'money' ? AMOUNT_NAMES[others.indexOf(c)] ?? `Amount (column ${others.indexOf(c) + 1})` : `Text ${k + 1}`));
  const tableLines = header ? lines.slice(header.at + header.n, last + 1) : body;

  // 6. A line with no amount and no date is the line above wrapping (a time
  // under its date, a description on two lines): its words join that row,
  // cell by cell, as a wrapped cell does in Excel.
  const rows = [headRow];
  let prevOwn = false;
  for (const l of tableLines) {
    const cells = cellsOf([l]);
    const own = l.words.some(isMoneyIn) || l.words.some(x => DATE.test(x.text));
    if (!own && rows.length > 1 && prevOwn) {
      const prev = rows[rows.length - 1];
      cells.forEach((c, k) => { if (c) prev[k] = prev[k] ? `${prev[k]} ${c}` : c; });
    } else {
      rows.push(cells);
      prevOwn = own;
    }
  }
  fixLostSeparators(rows, dateCol ? columns.indexOf(dateCol) : -1);
  // A transaction code read as "%2" or "x2" (the X misread): a cell that is
  // nothing but %/x and one digit is never anything else on a statement.
  for (const r of rows.slice(1)) r.forEach((c, k) => { if (/^[%x×]\d$/.test(c ?? '')) r[k] = `X${c.slice(1)}`; });
  const text = l => l.words.map(x => x.text).join(' ');
  const other = [...lines.slice(0, header ? header.at : top), ...lines.slice(last + 1)].map(text);
  // Date order from the WHOLE picture (a period "01/04/2026 - 30/04/2026" or a
  // print date at the top proves day-first even when every line is dated 1-12).
  // Any date that only makes sense month-first cancels it.
  const allDates = lines.flatMap(l => l.words).map(x => /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(x.text)).filter(Boolean);
  // A bank we have measured, named on the picture (the same marks the photos
  // card uses), prints its dates day-first: every one of our bank PDFs does.
  // Only the title area ABOVE a found heading row counts - where a bank prints
  // its own name: a transfer "to KRUNGTHAI" in a description, or a footer,
  // says nothing about how this statement writes its dates (G8 picture review
  // B1). Short names must stand as whole words ("BATT BANK" squashed holds "TTB").
  const title = header ? lines.slice(0, header.at).map(text) : [];
  const said = title.join(' ');
  const squashed = title.map(t => t.replace(/\s+/g, '').toUpperCase());
  const named = n => (n.length <= 5 && /^[A-Z]+$/.test(n)
    ? new RegExp(`(^|[^A-Z])${n}([^A-Z]|$)`).test(said.toUpperCase())
    : squashed.some(t => t.includes(n)));
  // A bank we have profiled, by the exact marks on its own statements, counts
  // as it is; a looser bank name only over a Thai-language heading - a Thai
  // bank's USD statement with English headings may write dates either way
  // (G8 picture re-review SF1).
  const thaiHeading = !!header && header.cells.some(c => /[฀-๿]/.test(c ?? ''));
  const knownBank = !!identify(said) || (thaiHeading && THAI_BANKS.some(named));
  const monthFirstSeen = allDates.some(m => +m[2] > 12 && +m[1] <= 12);
  // One misread date cannot show the order (G8 review 7): it takes two
  // different dates with a day over 12.
  const over12 = new Set(allDates.filter(m => +m[1] > 12 && +m[1] <= 31 && +m[2] <= 12).map(m => m[0]));
  const dayFirst = (knownBank || over12.size >= 2) && !monthFirstSeen;
  // what this page itself shows about its date order: 'day', 'month', or nothing
  const dateEvidence = dayFirst ? 'day' : monthFirstSeen ? 'month' : null;
  return { ok: true, rows, other, map: rolesOf(), dayFirst, dateEvidence, columns: columns.length, tilt, headingFound: !!header };

  // 7. Which column is which, mostly from what the columns HOLD - a heading
  // read imperfectly ("วันท ี", one heading over two columns) must not decide
  // it. Headings only tell withdrawals from deposits; when they cannot, the
  // amount columns are left unnamed as to direction and the balance decides.
  function rolesOf() {
    const map = {};
    const at = c => columns.indexOf(c);
    if (dateCol) map.date = at(dateCol);
    const bal = moneyCols.find(c => c.balance);
    map.balance = at(bal);
    const said = c => (header ? header.cells[at(c)] : '') ?? '';
    const roleSaid = c => roleOf(said(c));
    // a tax column (ภาษี / tax / WHT) is not money in or out
    const amounts = moneyCols.filter(c => !c.balance && !/ภาษี|tax|wht|vat/i.test(said(c))).sort((p, q) => p.right - q.right);
    const both = c => /ถอน.*ฝาก|ฝาก.*ถอน|debit.*credit|credit.*debit|dr.*cr/i.test(said(c).replace(/\s+/g, ''));
    if (amounts.length === 1) map.amount = at(amounts[0]);
    else if (amounts.length === 2) {
      const [l, r] = amounts;
      const rl = roleSaid(l), rr = roleSaid(r);
      if (rl === 'withdrawal' && rr === 'deposit') { map.withdrawal = at(l); map.deposit = at(r); }
      else if (rl === 'deposit' && rr === 'withdrawal') { map.deposit = at(l); map.withdrawal = at(r); }
      else if (both(l) && !roleSaid(r)) {
        // one heading over both, in its own order ("ถอนเงิน / ฝากเงิน")
        const t = said(l).replace(/\s+/g, '');
        const wFirst = Math.min(...['ถอน', 'debit', 'dr'].map(w => (t.toLowerCase().indexOf(w) + 1 || 1e9)))
          < Math.min(...['ฝาก', 'credit', 'cr'].map(w => (t.toLowerCase().indexOf(w) + 1 || 1e9)));
        map[wFirst ? 'withdrawal' : 'deposit'] = at(l); map[wFirst ? 'deposit' : 'withdrawal'] = at(r);
      } else { map.amount = at(l); map.amount2 = at(r); }
    } else if (amounts.length > 2) {
      // keep the two whose headings name a direction, else the two fullest
      const named = amounts.filter(c => ['withdrawal', 'deposit', 'amount'].includes(roleSaid(c)));
      const pick = (named.length >= 2 ? named : [...amounts].sort((p, q) => q.n - p.n)).slice(0, 2).sort((p, q) => p.right - q.right);
      map.amount = at(pick[0]); map.amount2 = at(pick[1]);
    }
    // the description: the text column holding the most writing
    const textLen = new Map(textCols.map(c => [c, 0]));
    for (const r of rows.slice(1)) textCols.forEach(c => textLen.set(c, textLen.get(c) + (r[at(c)] ?? '').length));
    const desc = [...textLen].sort((p, q) => q[1] - p[1])[0];
    if (desc) map.description = at(desc[0]);
    return map;
  }
}
