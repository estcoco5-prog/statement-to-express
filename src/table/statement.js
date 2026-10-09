// Spreadsheets made from pictures (one per page, in order) -> one Statement,
// proved line by line by engine/lines.js. The columns are the ones the person
// confirmed on screen; each file's own heading row is skipped.
import { linesStatement } from '../engine/lines.js';
import { findColumns, tableLines, moneyCell } from './columns.js';
import { TableError } from './read.js';

// A balance typed from the original: blank -> null; its minus sign kept (an
// overdraft); anything unreadable refused rather than quietly ignored.
function typed(text, which) {
  const m = moneyCell(text);
  if (m.blank) return null;
  if (m.cents === null) throw new TableError('bad-typed', `the ${which} balance "${text}" could not be read`);
  return m.sign === '-' ? -m.cents : m.cents;
}

// How far apart one file's dates may lie and still prove their own order.
export const SPAN_DAYS = 45;

// Said to the person, never acted on (Co 2026-10-09: "don't change the input,
// just fact check back to them"): nothing is held because of these.
export const WARN_OVERDRAFT = {
  en: 'Money in and out sit in one column with no + or − signs, and no balance shows a minus. If this account was overdrawn at any time, the directions could be reversed without any check failing - compare them with the paper.',
  th: 'เงินเข้าและออกอยู่คอลัมน์เดียวโดยไม่มีเครื่องหมาย + หรือ − และไม่มียอดติดลบ ถ้าบัญชีเคยติดลบ ทิศทางเงินอาจกลับด้านโดยไม่มีการตรวจใดไม่ผ่าน ให้เทียบกับกระดาษ',
};
export const WARN_DATES = {
  en: 'The balance proves each amount, not its date: dates are only checked to be in order - compare them with the paper.',
  th: 'ยอดคงเหลือยืนยันจำนวนเงิน ไม่ได้ยืนยันวันที่ ระบบตรวจเพียงว่าวันที่เรียงลำดับ ให้เทียบวันที่กับกระดาษ',
};
function warningsFor(lines, map) {
  const out = [WARN_DATES];
  const oneColumn = map.withdrawal === undefined && map.deposit === undefined;
  if (lines.length && oneColumn && lines.every(l => !l.sign) && lines.every(l => l.balance === null || l.balance >= 0)) {
    out.unshift(WARN_OVERDRAFT);
  }
  return out;
}

export const TABLE_PROFILE = {
  key: 'excel', bank: 'Spreadsheet from a picture (Excel → Express)', remarkFields: ['description'],
  amountSplitX: null, untested: false,
};

/**
 * @param files [{ name, rows }] the first sheet of each file, in page order
 * @param map { role: column index } as confirmed on screen
 * @param closingText the closing balance printed on the statement, as typed (optional)
 */
export function tableStatement(name, files, map, { account = null, closingText = '', openingText = '' } = {}) {
  const closing = typed(closingText, 'closing');
  const typedOpening = typed(openingText, 'opening');
  let opening = null;
  const lines = [], skipped = [];
  const squash = r => (r ?? []).map(c => String(c ?? '').toLowerCase().replace(/\s+/g, '')).join('|');
  let firstHeading = null;
  files.forEach((f, k) => {
    const found = findColumns(f.rows);
    if (k === 0 && found.header >= 0) firstHeading = squash(f.rows[found.header]);
    // On a later file an ordinary line can look like a heading ("ถอนเงินสด" |
    // "รับโอน"): it counts only if what it names sits where the confirmed columns are.
    // (or if it repeats file 1's heading word for word - a person may have
    // corrected a column on screen, so roles found again would not match)
    const fits = (firstHeading !== null && found.header >= 0 && squash(f.rows[found.header]) === firstHeading)
      || (Object.entries(found.map).every(([role, c]) => map[role] === c)
        && Object.keys(found.map).length >= Math.min(3, Object.keys(map).length));
    const header = k === 0 || fits ? found.header : -1;
    // f.doubts[i]: what the reader itself was unsure of on row i's date (passbook
    // pages) - a date note, so the row is held from Express like any doubtful date
    const got = tableLines(f.rows, map, { file: k + 1, header, opening: k === 0 ? null : opening ?? 0, listAbove: k > 0, doubts: f.doubts ?? [] });
    if (k === 0) opening = got.opening;
    if (k === 0 && got.openingAt) skipped.push(`${f.name}: ${got.openingAt}`);
    lines.push(...got.lines);
    skipped.push(...got.skipped.map(s => `${f.name}: ${s}`));
  });
  // A date that reads either way (02/04) is trusted only when the files PROVE
  // day-first: some date of the same kind (text, or Excel date number) has a
  // day over 12, and no text date only makes sense month-first. Text and date
  // numbers are proved apart: a converter set to US order turns 02/04 into a
  // swapped date number but leaves 13/04 as text (G8 reviews 3 and 4).
  // Proved per file: one file per page is often a separate conversion, with
  // its own setting (G8 review 5).
  // One date cannot prove a file: a single misread ("05/10" read as "05/18")
  // would make every swapped date in it look proved (G8 review 7). It takes two
  // different dates with a day over 12; the file's dates, read day-first, must
  // stay within SPAN_DAYS of each other (a converter set to US order scatters
  // 1-12 October over January to December); and date numbers beside text dates
  // with a day over 12 are the mark of such a converter, so they prove nothing.
  const proof = new Map();
  const proved = (page, kind) => {
    const key = `${page}|${kind}`;
    if (!proof.has(key)) {
      const own = lines.filter(l => l.page === page);
      const mine = own.filter(l => l.dateKind === kind && l.date && !l.dateNote);
      const monthFirst = own.some(l => /only makes sense month-first/.test(l.dateNote ?? ''));
      const over12 = new Set(mine.filter(l => l.dayOver12).map(l => l.date));
      const days = mine.map(l => Date.parse(l.date) / 864e5);
      const span = days.length ? Math.max(...days) - Math.min(...days) : 0;
      const textOver12 = own.some(l => l.dateKind === 'text' && l.dayOver12 && !l.dateNote);
      // a picture read by us: the whole page (a Thai bank's name, its other
      // dates) may show the order (picture/table.js)
      const seen = kind === 'text' && files[page - 1]?.dayFirst === true;
      proof.set(key, (seen || (over12.size >= 2 && span <= SPAN_DAYS))
        && !(kind === 'text' && monthFirst) && !(kind === 'number' && textOver12));
    }
    return proof.get(key);
  };
  // Every file's proof is settled before any line is marked: a line marked
  // early must not hide its date from the proof of the lines after it (G8 review 7 S-1).
  // A file whose order is not proved doubts its days over 12 as well: the
  // misread that failed to prove it ("05/10" read as "05/18") is one of them.
  const unsure = new Set(lines.filter(l => l.eitherWay && !l.dateNote && !proved(l.page, l.dateKind))
    .map(l => `${l.page}|${l.dateKind}`));
  for (const l of lines) {
    // No guessing from how the dates are spaced (a monthly payment on the 3rd,
    // read the wrong way round, becomes neat daily steps - G8 review 6).
    if (l.dateNote || !unsure.has(`${l.page}|${l.dateKind}`)) continue;
    if (l.eitherWay) {
      l.dateNote = `${l.eitherWay} could be day-first or month-first, and the dates in this file do not prove which (${l.where}) - check the date`;
    } else if (l.dayOver12) {
      l.dateNote = `the dates in this file do not agree on which way round they are written, so this one may be misread too (${l.where}) - check the date`;
    }
  }
  for (const l of lines) { delete l.eitherWay; delete l.dateKind; delete l.dayOver12; }
  // A file whose first line does not chain on from the file before (one
  // missing, out of order, or pictures that overlap) sends nothing: overlapping
  // pictures would otherwise send the repeated rows twice (G8 Excel review B2).
  const statement = linesStatement(name, lines, TABLE_PROFILE,
    { opening, closing, account, pageWord: 'file', typedOpening, holdBrokenPages: true });
  statement.skipped = skipped;
  statement.warnings = warningsFor(lines, map);
  return statement;
}
