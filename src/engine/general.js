// The general reader - a bank with no profile yet (Co 2026-10-02: untested
// banks are in, capped at yellow, named UNTESTED). Port of the answer key's
// general_profile. Simple tables only: it finds the columns from the page
// itself rather than from measurements.
//
//   header   the first line with a date label (วันที่ / Date) that has a
//            balance label (คงเหลือ / Balance) on it or within HEADER_REACH
//   date     where the dates below the header sit
//   money    numbers grouped by their right edge; the balance is the group
//            present on (nearly) every dated row - the rightmost if two are
//   time     a time beside the date on most rows gets its own column
//   text     left of the money = description, right of the balance = channel;
//            Express's REMARK gets both, left to right
//
// Which amount column is withdrawals is NOT guessed: some banks print deposits
// first. The running balance alone decides direction, as it always does.
import { DATE_RE, TIME_RE, ROW_TOLERANCE, groupIntoRows, rowText, rowY } from './rows.js';
import { parseAmount } from './money.js';
import { profile, col } from './profiles.js';
import { Cell, BAD } from './output/xlsx.js';

const DATE_LABELS = ['วันที่', 'date'];
const BALANCE_LABELS = ['คงเหลือ', 'balance'];
const OPENING = ['ยอดยกมา', 'ยอดคงเหลือยกมา', 'B/F', 'BALANCE BROUGHT FORWARD', 'Opening Balance'];
const ACCOUNT = ['เลขที่บัญชี', 'บัญชีเลขที่', 'Account No', 'Account Number'];
const HEADER_REACH = 12.0;      // pt: a column header printed on two lines
const CLUSTER_REACH = 6.0;      // pt: right edges of one money column
const BALANCE_COVERAGE = 0.9;   // share of dated rows the balance column must reach
// A wrap starts within this many row spacings (the smallest gap between two
// transaction rows) below the line above it. Measured: wraps 0.85 (KKP) and
// 1.08 (KBank); footers 2.0 (BBL) and 2.9 (KBank). Row spacing, not word
// height, because the two PDF readers measure word heights differently.
const WRAP_REACH = 1.5;
const PERIOD_PAIR_RE = /\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})\b/g;

export const UNTESTED_CAVEAT = 'UNTESTED BANK - this bank has not been tested yet. Amounts are ' +
  'proved by the balance; check dates and descriptions by eye. / ' +
  'ธนาคารนี้ยังไม่ได้ทดสอบ ยอดเงินตรวจด้วยยอดคงเหลือแล้ว ' +
  'โปรดตรวจวันที่และรายละเอียดด้วยตา';

// An untested bank's Proof sheet opens with the caveat, in red.
export function caveatFirst(proof, p) {
  if (p.untested) proof.add(new Cell(UNTESTED_CAVEAT, BAD));
}

// Python's max(xs, key=f): the FIRST item with the largest key.
const firstMax = (xs, f) => xs.reduce((best, x) => (f(x) > f(best) ? x : best));

function headerBand(rows) {
  for (const row of rows) {
    if (!row.some(w => DATE_LABELS.some(l => w.text.toLowerCase().startsWith(l)))) continue;
    const near = rows.filter(r => Math.abs(rowY(r) - rowY(row)) <= HEADER_REACH);
    const words = near.flat();
    if (words.some(w => BALANCE_LABELS.some(l => w.text.toLowerCase().includes(l)))) {
      return [Math.min(...words.map(w => w.y0)), Math.max(...words.map(w => w.y1))];
    }
  }
  return null;
}

// Group items whose key lies within `reach` of the group's running mean.
function clusters(items, key, reach) {
  const groups = [];
  for (const item of [...items].sort((a, b) => key(a) - key(b))) {
    const g = groups.at(-1);
    if (g && Math.abs(key(item) - g.mean) <= reach) {
      g.items.push(item);
      g.mean = g.items.reduce((a, i) => a + key(i), 0) / g.items.length;
    } else {
      groups.push({ items: [item], mean: key(item) });
    }
  }
  return groups;
}

const distinctRows = g => new Set(g.items.map(([, i]) => i)).size;

// Build a profile for an unknown bank from the page itself, or null.
export function generalProfile(pages) {
  const data = [];
  let periodText = null;
  for (const [pageNo, page] of pages.entries()) {
    const rows = groupIntoRows(page);
    const band = headerBand(rows);
    if (band === null) continue;
    if (periodText === null) {
      const above = rows.filter(r => rowY(r) < band[0] && (rowText(r).match(PERIOD_PAIR_RE) ?? []).length >= 2);
      if (above.length) periodText = rowText(above.at(-1));       // the nearest one above
    }
    data.push(...rows.filter(r => rowY(r) > band[1]).map(r => [pageNo, r]));
  }
  if (!data.length) return null;

  const firsts = [];
  for (const [pageNo, row] of data) {
    const dates = row.filter(w => DATE_RE.test(w.text));
    if (dates.length) firsts.push([dates.reduce((a, w) => (w.x0 < a.x0 ? w : a)), row, pageNo]);
  }
  if (!firsts.length) return null;
  const dateGroup = firstMax(clusters(firsts, ([w]) => w.x0, CLUSTER_REACH), g => g.items.length);
  const dateLo = Math.min(...dateGroup.items.map(([w]) => w.x0)) - 1.0;
  const dateHi = Math.max(...dateGroup.items.map(([w]) => w.x1)) + 1.0;
  const dated = dateGroup.items.map(([, row]) => row);
  // Python iterates a set of page numbers here; the min below is order-free.
  const spacings = [];
  for (const pageNo of new Set(dateGroup.items.map(([, , p]) => p))) {
    const ys = dateGroup.items.filter(([, , p]) => p === pageNo).map(([, r]) => rowY(r)).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > ROW_TOLERANCE) spacings.push(ys[i] - ys[i - 1]);
  }

  const money = [];
  dated.forEach((row, i) => {
    for (const w of row) if (w.x0 > dateHi && parseAmount(w.text) !== null) money.push([w, i]);
  });
  const groups = clusters(money, ([w]) => w.x1, CLUSTER_REACH);
  for (const g of groups) {
    g.rows = distinctRows(g);
    g.lo = Math.min(...g.items.map(([w]) => w.x0));
    g.hi = Math.max(...g.items.map(([w]) => w.x1));
  }
  const full = groups.filter(g => g.rows >= BALANCE_COVERAGE * dated.length);
  if (!full.length) return null;
  const balance = firstMax(full, g => g.mean);
  const amounts = groups.filter(g => g !== balance);
  if (!amounts.length || amounts.some(g => g.mean > balance.mean)) return null;
  const last = firstMax(amounts, g => g.mean);
  const split = last.hi < balance.lo ? (last.hi + balance.lo) / 2 : (last.mean + balance.mean) / 2;
  const firstLo = Math.min(...amounts.map(g => g.lo)) - 0.5;
  if (firstLo <= dateHi) return null;

  // A time printed beside the date on most rows gets its own column, so the
  // description is the transaction's text alone.
  let textLo = dateHi;
  const columns = [col('date', dateLo, dateHi)];
  const times = [];
  dated.forEach((row, i) => {
    for (const w of row) if (TIME_RE.test(w.text) && w.x0 > dateHi && w.x1 < firstLo) times.push([w, i]);
  });
  if (times.length) {
    const tg = firstMax(clusters(times, ([w]) => w.x0, CLUSTER_REACH), distinctRows);
    if (distinctRows(tg) >= 0.5 * dated.length) {
      textLo = Math.max(...tg.items.map(([w]) => w.x1)) + 1.0;
      columns.push(col('time', dateHi, textLo));
    }
  }

  const allText = pages.flatMap(p => groupIntoRows(p)).map(rowText).join('\n');
  if (!OPENING.some(m => allText.includes(m))) return null;

  return profile({
    key: 'untested', bank: 'Untested bank',
    columns: [...columns,
      col('description', textLo, firstLo),
      col('amount', firstLo, split),
      col('balance', split, balance.hi + 2.0),
      col('channel', balance.hi + 2.0, 10000.0)],
    amountSplitX: null,
    // Which text is the useful part is not known for a new bank, so Express's
    // REMARK gets all of it, left to right.
    remarkFields: ['description', 'channel'],
    wrapReach: spacings.length ? WRAP_REACH * Math.min(...spacings) : null,
    untested: true,
    marks: {
      identify: [], opening: OPENING, closing: [], total_withdraw: [], total_deposit: [],
      period: periodText ? [periodText] : [], account_no: ACCOUNT, account_name: [], branch: [],
      footer: [], furniture_text: [],
    },
  });
}
