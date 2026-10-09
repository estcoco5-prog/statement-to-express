// A spreadsheet of bank lines -> the lines engine/lines.js proves. Finds the
// heading row and which column is which (Thai or English headings), turns each
// cell into a date or an amount, and says plainly what could not be read.
// Nothing here is trusted: the balance chain decides.

export const ROLES = ['date', 'description', 'withdrawal', 'deposit', 'amount', 'amount2', 'balance'];
export const ROLE_TEXT = {
  date: 'Date · วันที่', description: 'Description · รายการ', withdrawal: 'Withdrawal · ถอน',
  deposit: 'Deposit · ฝาก', amount: 'Amount (+/-) · จำนวนเงิน',
  amount2: 'Amount, 2nd column (the balance decides in or out) · จำนวนเงิน คอลัมน์ที่ 2', balance: 'Balance · คงเหลือ',
};

// Heading words, most specific first ("รายการถอน" is a withdrawal, not a description).
const HEADINGS = [
  ['balance', ['คงเหลือ', 'balance', 'bal.', 'ยอดเงินคงเหลือ', 'outstanding']],
  // one column for both ways, named so: a signed amount
  ['amount', ['debit/credit', 'dr/cr', 'ถอน/ฝาก', 'เดบิต/เครดิต', 'withdrawal/deposit', 'รายการถอน/ฝาก']],
  ['withdrawal', ['ถอน', 'withdraw', 'debit', 'เดบิต', 'จ่าย', 'moneyout', 'paidout', 'dr']],
  ['deposit', ['ฝาก', 'deposit', 'credit', 'เครดิต', 'รับ', 'moneyin', 'paidin', 'cr']],
  ['amount2', ['amount(2ndcolumn)']],
  ['amount', ['จำนวนเงิน', 'amount', 'ยอดเงิน']],
  ['date', ['วันที่', 'date', 'วันเดือนปี', 'วัน/เดือน/ปี']],
  ['description', ['รายการ', 'รายละเอียด', 'description', 'details', 'particular', 'narrative', 'คำอธิบาย', 'transaction', 'หมายเหตุ', 'remark', 'code', 'คำย่อ']],
];
const squash = v => String(v ?? '').toLowerCase().replace(/[\s_]+/g, '');

export function roleOf(cell) {
  const t = squash(cell);
  if (!t || t.length > 40) return null;
  for (const [role, words] of HEADINGS) {
    // short English abbreviations ("dr", "cr") must be the whole heading
    if (words.some(w => (/^[a-z.]{1,3}$/.test(w) ? t === w || t === `${w}.` : t.includes(w)))) return role;
  }
  return null;
}

/** The heading row and its columns: { header: row index or -1, map: { role: column } } */
export function findColumns(rows) {
  let best = { header: -1, map: {}, score: 0 };
  rows.slice(0, 25).forEach((row, i) => {
    const map = {};
    row.forEach((cell, c) => { const role = roleOf(cell); if (role && map[role] === undefined) map[role] = c; });
    const score = Object.keys(map).length + (map.balance !== undefined ? 1 : 0);
    if (score > best.score && Object.keys(map).length >= 2) best = { header: i, map, score };
  });
  return { header: best.header, map: best.map };
}

// ---- cells -------------------------------------------------------------------

/** "1,234.50", "(1,234.50)", "-1,234.50", "1,234.50-", "*1,234.50", "฿1,234.50 Dr", 1234.5 -> { cents, sign } */
export function moneyCell(v) {
  if (v === '' || v === null || v === undefined) return { cents: null, sign: null, blank: true };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { cents: null, sign: null, bad: String(v) };
    const cents = Math.round(Math.abs(v) * 100);
    // more than 2 decimals is not money as printed - say so, never round quietly
    if (Math.abs(Math.abs(v) * 100 - cents) > 1e-6) return { cents: null, sign: null, bad: String(v) };
    return { cents, sign: v < 0 ? '-' : null };
  }
  let t = String(v).trim().replace(/฿|thb|บาท/gi, '').trim();
  // a space BETWEEN digits ("1 2 3 4.50") is not one number
  if (/\d\s+\d/.test(t)) return { cents: null, sign: null, bad: String(v) };
  t = t.replace(/\s+/g, '');
  if (t === '' || t === '-' || t === '–') return { cents: null, sign: null, blank: true };
  let sign = null;
  if (/^\(.*\)$/.test(t)) { sign = '-'; t = t.slice(1, -1); }
  if (/dr$/i.test(t)) { sign = '-'; t = t.slice(0, -2); } else if (/cr$/i.test(t)) { sign = '+'; t = t.slice(0, -2); }
  if (/^[+\-*]/.test(t)) { if (t[0] !== '*') sign = t[0]; t = t.slice(1); }
  if (/-$/.test(t)) { sign = '-'; t = t.slice(0, -1); }
  // Thai digits, just in case
  t = t.replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0E50));
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(t)) return { cents: null, sign: null, bad: String(v) };
  const [whole, frac = ''] = t.replace(/,/g, '').split('.');
  return { cents: Number(whole) * 100 + Number((frac + '00').slice(0, 2)), sign };
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
};
const iso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
// A year as written: 4 digits (2568 is Buddhist), or 2 digits - 60-99 read as
// Buddhist (68 = 2568 = 2025), 00-59 as Western (25 = 2025).
function fullYear(y) {
  if (y >= 2400) return y - 543;
  if (y >= 1900) return y;
  if (y < 100) return y >= 60 ? 2500 + y - 543 : 2000 + y;
  return null;
}

/** a cell -> { iso, note }. Day first, as Thai statements print it. */
export function dateCell(v) {
  const d = readDate(v);
  // A year far from now is a misread or a converter's guess (Excel turning
  // "05/06/68" into 1968): listed, never sent quietly (G8 Excel review S3).
  const latest = new Date().getUTCFullYear() + 1;
  if (d.iso && !d.note && (+d.iso.slice(0, 4) < 2000 || +d.iso.slice(0, 4) > latest)) {
    return { iso: d.iso, note: `the date reads ${d.iso.slice(8, 10)}/${d.iso.slice(5, 7)}/${d.iso.slice(0, 4)}, an unlikely year - check the date` };
  }
  return d;
}
function readDate(v) {
  if (v === '' || v === null || v === undefined) return { iso: null, note: null, blank: true };
  if (typeof v === 'number') {
    // Excel keeps a date as a day count from 1899-12-30
    // A converter may already have swapped day and month for days 1-12 (a US
    // setting): such a date number can be either way round too.
    if (v > 20000 && v < 80000) {
      const iso = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
      const d = +iso.slice(8, 10), m = +iso.slice(5, 7);
      return { iso, note: null, kind: 'number', dayOver12: d > 12, eitherWay: d <= 12 && m <= 12 && d !== m ? `the date number ${v} (${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)})` : null };
    }
    return { iso: null, note: `"${v}" is not a date` };
  }
  const t = String(v).trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) { const d = iso(fullYear(+m[1]), +m[2], +m[3]); return d ? { iso: d, note: null } : { iso: null, note: `"${t}" is not a real date` }; }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(t);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], fullYear(+m[3])];
    const d = iso(y, b, a);
    // 02/04 could be either way round; table/statement.js decides by the file's
    // other dates. Only a day over 12 shows the order: a Buddhist year does not
    // (04/01/2568 can be written month-first too - G8 review 6).
    if (d) return { iso: d, note: null, kind: 'text', dayOver12: a > 12,
      eitherWay: a <= 12 && b <= 12 && a !== b ? `"${t}"` : null };
    const swapped = iso(y, a, b);
    if (swapped) return { iso: swapped, note: `"${t}" only makes sense month-first - check the date` };
    return { iso: null, note: `"${t}" is not a real date` };
  }
  m = /^(\d{1,2}) ?([a-z]{3}|[ก-๎]{1,3}\.[ก-๎]{1,2}\.?)[a-z]* ?(\d{2}|\d{4})?$/i.exec(t);
  if (m) {
    const key = m[2].toLowerCase().slice(0, 3);
    const mo = MONTHS[key] ?? MONTHS[m[2]] ?? MONTHS[`${m[2]}.`.replace('..', '.')];
    if (mo && m[3]) { const d = iso(fullYear(+m[3]), mo, +m[1]); if (d) return { iso: d, note: null }; }
    return { iso: null, note: `"${t}" has no year, or is not a real date - check the date` };
  }
  return { iso: null, note: `"${t}" could not be read as a date` };
}

const OPENING = /ยอดยกมา|ยกมา|b\/f|broughtforward|balanceforward|openingbalance|ยอดคงเหลือยกมา|beginningbalance/;
const TOTALS = /^(รวม|total|ยอดรวม|grandtotal|sum)/;
const CARRIED = /ยอดยกไป|ยกไป|c\/f|carriedforward|closingbalance|ยอดคงเหลือปลายงวด|endingbalance|summary|สรุป/;

/**
 * Rows of one sheet -> lines for engine/lines.js. A heading row repeated on a
 * later page is skipped; a row with only a description is the line above
 * running on; a brought-forward row opens the account.
 * @returns {{ lines, opening, skipped }}
 */
export function tableLines(rows, map, { file = 1, header = -1, opening = null, listAbove = false, doubts = [] } = {}) {
  const lines = [], skipped = [];
  let openingAt = null;
  // One signed amount column: once it shows any minus, a figure without one is money in.
  const signedColumn = map.amount !== undefined && map.amount !== null && rows.some((row, i) => i > header && moneyCell(row[map.amount]).sign === '-');
  const headerText = header >= 0 ? rows[header].map(squash).join('|') : null;
  const cell = (row, role) => (map[role] === undefined || map[role] === null ? '' : row[map[role]] ?? '');
  rows.forEach((row, i) => {
    const where = `file ${file} row ${i + 1}`;
    // Above the heading: titles are skipped, but a row carrying an amount and a
    // balance is a transaction (a picture across a page break) - read it, never
    // drop it silently (G8 review 5).
    if (i === header) return;
    if (i < header) {
      const money = role => !moneyCell(cell(row, role)).blank && moneyCell(cell(row, role)).cents !== null;
      // a summary (opening, totals, closing, carried forward) sits above headings too: only
      // a row with a real date and money, named as none of those, is a transaction (G8 review 6)
      const words = row.map(squash).join(' ');
      const summary = OPENING.test(words) || row.some(c => TOTALS.test(squash(c))) || CARRIED.test(words);
      const isLine = !summary && !!dateCell(cell(row, 'date')).iso && money('balance')
        && ['withdrawal', 'deposit', 'amount', 'amount2'].some(money);
      if (!isLine) {
        if (listAbove && row.some(c => String(c ?? '').trim())) skipped.push(`${where}: above the heading row`);
        return;
      }
    }
    if (row.every(c => String(c ?? '').trim() === '')) return;
    if (headerText && row.map(squash).join('|') === headerText) return;
    const words = row.map(squash).join(' ');
    const desc = String(cell(row, 'description') ?? '').trim();
    const wd = moneyCell(cell(row, 'withdrawal')), dp = moneyCell(cell(row, 'deposit'));
    const am = moneyCell(cell(row, 'amount')), am2 = moneyCell(cell(row, 'amount2')), bal = moneyCell(cell(row, 'balance'));
    const date = dateCell(cell(row, 'date'));
    const hasMoney = [wd, dp, am, am2, bal].some(x => !x.blank);
    // A totals row carries no running balance; a payee called "TOTAL ACCESS..." does (G8 review S5).
    if (bal.blank && (TOTALS.test(squash(desc)) || (TOTALS.test(squash(row.find(c => String(c ?? '').trim()) ?? '')) && !date.iso))) { skipped.push(`${where}: a totals row`); return; }
    if (!hasMoney && date.blank) {
      // a description running on from the line above
      if (lines.length && desc) lines[lines.length - 1].description += ` ${desc}`;
      else if (desc) skipped.push(`${where}: text only`);
      return;
    }
    // The brought-forward row: a balance and no amount, before any line, labelled
    // so or with no date at all (an unreadable date is a line to check, not an
    // opening - G8 review S1). On a later file it repeats the last balance of the
    // file before: dropped, since the next line's chain checks that join anyway.
    const noAmount = [wd, dp, am, am2].every(x => x.blank);
    if (noAmount && bal.cents !== null && !lines.length && (OPENING.test(words) || (date.blank && opening === null))) {
      const value = bal.sign === '-' ? -bal.cents : bal.cents;
      if (opening === null) { opening = value; openingAt = `${where}: used as the opening balance`; }
      else skipped.push(`${where}: a brought-forward line`);
      return;
    }
    const notes = [];
    let amount = null, sign = null;
    const filled = [['withdrawal', wd, '-'], ['deposit', dp, '+'], ['amount', am, null], ['amount2', am2, null]].filter(([, x]) => !x.blank);
    if (filled.length > 1 && !(filled.length === 2 && filled.some(([, x]) => x.cents === 0))) {
      notes.push(`more than one amount on this line (${where}) - check it`);
    } else if (filled.length) {
      const [, x, side] = filled.find(([, x]) => x.cents !== 0) ?? filled[0];
      if (x.cents === null) notes.push(`"${x.bad}" could not be read as an amount (${where})`);
      else { amount = x.cents; sign = side ?? x.sign ?? (x === am && signedColumn ? '+' : null); }
    }
    if (bal.bad) notes.push(`"${bal.bad}" could not be read as a balance (${where})`);
    lines.push({
      page: file, line: i + 1, where, description: desc,
      amount, sign, balance: bal.cents === null ? null : bal.sign === '-' ? -bal.cents : bal.cents,
      date: date.iso, dateNote: [date.note ? `${date.note} (${where})` : null, doubts[i] ?? null].filter(Boolean).join('; ') || null, notes, eitherWay: date.eitherWay ?? null, dateKind: date.kind ?? null, dayOver12: !!date.dayOver12,
    });
  });
  return { lines, opening, skipped, openingAt };
}
