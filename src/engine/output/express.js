// Express X Import - the ฝาก-ถอนเงิน template, sheet BKTRN, one combined file
// per account. Ported from the answer key.
//
// Express reads its import sheets by the FIELD CODES on row 3. Rows 1-2 are
// reproduced exactly as the template has them. BKTRN has one AMOUNT column and
// no direction flag, so two helper columns (G ถอน, H ฝาก) follow the template's
// six, shaded grey and labelled "delete before importing" - the template's own
// rule for added columns. AMOUNT stays positive.
import { Sheet, Cell, money, writeXlsx, HEADER, BOLD, BAD, PLAIN, DATE, MONEY, TODO, EXTRA, EXTRA_MONEY, EXTRA_HEAD } from './xlsx.js';
import { caveatFirst } from '../general.js';
import { rowsToCheck } from '../statement.js';

// Copied from the answer key (generated with json.dumps) - rows 1-3 must stay
// byte-identical to Express's ข้อมูลฝาก-ถอนเงิน template. Do not edit by hand.
export const BKTRN_LABELS = ["เลขที่เอกสาร", "วันที่เอกสาร  (วว/ดด/ปปปป) ค.ศ.เท่านั้น", "แผนก", "จำนวนเงิน", "ธนาคาร", "หมายเหตุ"];
export const BKTRN_LIMITS = ["ใส่ไม่เกิน 10 ตัว", "ใส่ไม่เกิน 8 ตัว", "ใส่ไม่เกิน 4 ตัว", "", "ใส่ไม่เกิน 2 ตัว", "ใส่ไม่เกิน 50 ตัว"];
export const BKTRN_FIELDS = ["DOCNUM", "DOCDAT", "DEPCOD", "AMOUNT", "BNKACC", "REMARK"];
export const DIRECTION_LABELS = ["ถอน", "ฝาก"];
export const DIRECTION_NOTE = "ลบคอลัมน์นี้ก่อนนำเข้า";      // delete this column before importing
export const DIRECTION_FIELDS = ["WITHDRAW", "DEPOSIT"];
export const REMARK_LIMIT = 50;

// The template's own อ่านก่อน (read first) sheet - Express's instructions for
// filling the import file. Copied from the answer key (generated with
// json.dumps from the real template; Co 2026-10-02: every Express file
// carries it). Do not edit by hand.
export const READ_FIRST_NAME = "อ่านก่อน";
export const READ_FIRST_WIDTHS = [4, 21.1640625, 21.1640625, 21.1640625, 27.33203125, 77.5, 28.5, 94];
export const READ_FIRST = [
  ["B1", "รายละเอียดการกรอกข้อมูลในไฟล์ Excel ก่อนนำเข้าสู่โปรแกรม X Import ", "BOLD"],
  ["B2", "ชื่อฟิลด์", "HEADER"],
  ["C2", "รูปแบบ (Format)", "HEADER"],
  ["D2", "จัดชิด", "HEADER"],
  ["E2", "จำนวนที่กรอกได้", "HEADER"],
  ["F2", "รายละเอียด", "HEADER"],
  ["G2", "ตัวอย่าง", "HEADER"],
  ["H2", "หมายเหตุ", "HEADER"],
  ["B3", "DOCNUM", "PLAIN"],
  ["C3", "ข้อความ", "PLAIN"],
  ["D3", "ซ้าย", "PLAIN"],
  ["E3", 10, "PLAIN"],
  ["F3", "เลขที่เอกสาร", "PLAIN"],
  ["G3", "IV000001", "PLAIN"],
  ["H3", "แนะนำต้องกรอก", "PLAIN"],
  ["B4", "DOCDAT", "PLAIN"],
  ["C4", "วันที่", "PLAIN"],
  ["D4", "ซ้าย", "PLAIN"],
  ["E4", 8, "PLAIN"],
  ["F4", "วันที่เอกสาร (วว/ดด/ปปปป) ค.ศ.เท่านั้น", "PLAIN"],
  ["G4", 45301, "DATE"],
  ["H4", "แนะนำต้องกรอก", "PLAIN"],
  ["B5", "DEPCOD", "PLAIN"],
  ["C5", "ข้อความ", "PLAIN"],
  ["D5", "ซ้าย", "PLAIN"],
  ["E5", 4, "PLAIN"],
  ["F5", "รหัสแผนก", "PLAIN"],
  ["G5", "กบ", "PLAIN"],
  ["H5", "กรอกหรือไม่ก็กรอกก็ได้", "PLAIN"],
  ["B6", "AMOUNT", "PLAIN"],
  ["C6", "ตัวเลข", "PLAIN"],
  ["D6", "ขวา", "PLAIN"],
  ["E6", 999999999.99, "MONEY"],
  ["F6", "จำนวนเงิน", "PLAIN"],
  ["G6", 137000, "MONEY"],
  ["H6", "แนะนำต้องกรอก", "PLAIN"],
  ["B7", "BNKACC", "PLAIN"],
  ["C7", "ข้อความ", "PLAIN"],
  ["D7", "ซ้าย", "PLAIN"],
  ["E7", 2, "PLAIN"],
  ["F7", "รหัสธนาคาร", "PLAIN"],
  ["G7", "K1", "PLAIN"],
  ["H7", "แนะนำต้องกรอก", "PLAIN"],
  ["B8", "REMARK", "PLAIN"],
  ["C8", "ข้อความ", "PLAIN"],
  ["D8", "ซ้าย", "PLAIN"],
  ["E8", 50, "PLAIN"],
  ["F8", "หมายเหตุ", "PLAIN"],
  ["G8", "โปรแกรม X Import", "PLAIN"],
  ["H8", "กรอกหรือไม่ก็กรอกก็ได้", "PLAIN"],
  ["C10", "วิธีการแปลงตัวเลขเป็นข้อความโดยใช้สูตร Excel ", "BOLD"],
  ["C11", "เลือก Cell ช่องว่างสำหรับการเขียนสูตรก่อน เช่น B1 จากนั้นให้เลือก Cell ที่เป็นข้อมูลตัวเลข เช่น A1 จากนั้นใส่สูตร Excel ลงไป คือ =A1&\"\" จะได้การแปลงข้อมูลตัวเลข (Numeric) เป็นข้อความ (Text) ", "PLAIN"],
  ["C12", "ตัวอย่าง", "BOLD"],
  ["C13", "Cell A1", "HEADER"],
  ["D13", "Cell B1", "HEADER"],
  ["C14", "STKCOD", "HEADER"],
  ["D14", "แปลงค่า", "HEADER"],
  ["C15", 410001, "PLAIN"],
  ["D15", "410001", "PLAIN"],
  ["E15", " เขียนสูตรลงไปใน Cell B1 ก่อน จากนั้นให้คัดลอก (Copy) ไปวางใส่ Cell A1 โดยวางแบบค่า (า) ลงไป", "PLAIN"],
  ["C17", "Cell A1", "HEADER"],
  ["D17", "Cell B1", "HEADER"],
  ["C18", "STKCOD", "HEADER"],
  ["D18", "แปลงค่า", "HEADER"],
  ["C19", "410001", "PLAIN"],
  ["D19", "410001", "PLAIN"],
  ["E19", " เมื่อคัดลอก Cell B1 ไปวางที่ Cell A1 แล้ว ที่มุม Cell A1 จะมีสามเหลี่ยมสีเขียวแสดงขึ้นมา แสดงว่าทำข้อมูลได้ถูกต้อง", "PLAIN"],
  ["C21", "- ชีทที่นำเข้าข้อมูลจะต้องเป็นชีทที่ 1 เสมอ และสามารถแก้ไขชื่อชีทหรือชื่อไฟล์ของ Excel ได้ ", "PLAIN"],
  ["C22", "- ใน 3 บรรทัดแรกของชีทข้อมูล ห้ามลบหรือแก้ไขโดยเด็ดขาด หากต้องการแทรกคอลัมน์ สามารถแทรกได้ แต่เมื่อแทรกคอลัมน์แล้ว ต้องลบคอลัมน์นั้น ก่อนนำเข้าข้อมูล ห้ามซ่อนคอลัมน์ที่เพิ่มมาเด็ดขาด", "PLAIN"],
  ["C23", "โดยคอลัมน์ Field จะต้องอยู่ครบตามเดิม และแถว Field จะอยู่บรรทัดที่ 3 เสมอ", "PLAIN"],
  ["C24", "- สำหรับการลบแถวบรรทัด ในชีทแรกของไฟล์นี้ จะเป็นรูปแบบตาราง ถ้าลบข้อมูลในแถว ต้องลบแถวของตารางด้วย มิเช่นนั้นเมื่อนำเข้าข้อมูล โปรแกรมจะมองเป็นแถวว่าง ทำให้โปรแกรมไม่สามารถนำเข้าข้อมูลได้", "PLAIN"],
];

const pad = (n, w = 2) => String(n).padStart(w, '0');
const basename = name => String(name).split(/[\\/]/).pop();

// '2026-06-09' -> the integer Excel stores behind a date cell (epoch 1899-12-30).
// Returns null for anything that is not a real ISO date.
export function excelSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return (t - Date.UTC(1899, 11, 30)) / 86400000;
}

// Python slices code points; so must we, or a Thai character could be cut in half.
const cut = s => [...s].slice(0, REMARK_LIMIT).join('');

// The best one-line description a row has, cut to Express's 50. `fields` is the
// bank profile's remarkFields: those fields joined, when any has text.
export function remarkFor(row, fields = null) {
  if (fields && fields.length) {
    const text = fields.map(f => (row[f] ?? '').trim()).filter(Boolean).join(' ');
    if (text) return cut(text);
  }
  for (const t of [row.description, row.channel, row.details]) {
    const s = (t ?? '').trim();
    if (s) return cut(s);
  }
  return '';
}

const directionCell = v => (v !== null ? money(v, EXTRA_MONEY) : new Cell('', EXTRA));

// The import sheet: the template's six columns, then ถอน and ฝาก. With no data
// rows there is no table: a header-only table would need the blank row the
// template warns about.
export function buildBktrn(rows, remarkFields) {
  const sheet = new Sheet('BKTRN', { widths: [13, 13, 8, 14, 9, 46, 14, 14], freezeRows: 3,
    table: rows.length ? ['Table1', 3] : null });
  sheet.add(...BKTRN_LABELS.map(l => new Cell(l, HEADER)), ...DIRECTION_LABELS.map(l => new Cell(l, EXTRA_HEAD)));
  sheet.add(...BKTRN_LIMITS, new Cell(DIRECTION_NOTE, EXTRA), new Cell(DIRECTION_NOTE, EXTRA));
  sheet.add(...BKTRN_FIELDS.map(f => new Cell(f, BOLD)), ...DIRECTION_FIELDS.map(f => new Cell(f, EXTRA_HEAD)));
  for (const row of rows) {
    // A row whose date could not be read is still written - blank in that one
    // cell - because dropping it would hide it.
    const serial = excelSerial(row.date);
    const amount = row.withdrawal !== null ? row.withdrawal : row.deposit;
    sheet.add(new Cell('', TODO),                                  // DOCNUM - team fills
      serial === null ? new Cell('', DATE) : new Cell(serial, DATE),
      new Cell('', PLAIN),                                         // DEPCOD - optional
      money(amount),                                               // AMOUNT
      new Cell('', TODO),                                          // BNKACC - must fill
      remarkFor(row, remarkFields),                                // REMARK
      directionCell(row.withdrawal),                               // ถอน
      directionCell(row.deposit));                                 // ฝาก
  }
  return sheet;
}

// The template's อ่านก่อน sheet, cell for cell, in our styles. A whole number
// is written as Python writes an int; 999999999.99 as Python writes a float.
export function buildReadFirst() {
  const styles = { PLAIN, BOLD, HEADER, DATE, MONEY };
  const grid = new Map();
  for (const [ref, value, style] of READ_FIRST) {
    const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(ref);
    const col = [...letters].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const r = Number(digits);
    if (!grid.has(r)) grid.set(r, new Map());
    const kind = typeof value !== 'number' ? 'text' : Number.isInteger(value) ? 'int' : 'float';
    grid.get(r).set(col, new Cell(value, styles[style], kind));
  }
  const sheet = new Sheet(READ_FIRST_NAME, { widths: READ_FIRST_WIDTHS });
  for (let r = 1; r <= Math.max(...grid.keys()); r++) {
    const row = grid.get(r) ?? new Map();
    const width = row.size ? Math.max(...row.keys()) + 1 : 0;
    sheet.add(...Array.from({ length: width }, (_, c) => row.get(c) ?? ''));
  }
  return sheet;
}

// Python's f"{Decimal:,.2f}".
export function fmtComma(satang) {
  const sign = satang < 0 ? '-' : '';
  const a = Math.abs(satang);
  return `${sign}${Math.floor(a / 100).toLocaleString('en-US')}.${pad(a % 100)}`;
}

// The second sheet of a combined Express file: what went in, what did not.
export function buildBatchProof(group, wdTotal, depTotal) {
  const proof = new Sheet('Proof', { widths: [46, 10, 52] });
  caveatFirst(proof, group.profile);
  proof.add(new Cell('Express import file - ฝาก-ถอนเงิน (BKTRN), several statements', BOLD));
  proof.add('');
  for (const [label, value] of [
    ['Bank', group.profile.bank],
    ['Account number', group.account || '(not read - this file holds one statement)'],
    ['Statements in this file', group.statements.length - group.excluded().length],
    ['Rows in this file', group.expressRows().length],
    ['Withdrawals (ถอน)', fmtComma(wdTotal)],
    ['Deposits (ฝาก)', fmtComma(depTotal)],
  ]) proof.add(new Cell(label, BOLD), '', String(value));

  proof.add('');
  proof.add(new Cell('Before importing', BOLD));
  proof.add(new Cell('1. Fill every YELLOW cell', TODO), '', 'DOCNUM and BNKACC');
  proof.add(new Cell('2. Delete columns G and H (ถอน, ฝาก)', EXTRA_HEAD), '', 'they are for checking only');

  proof.add('');
  proof.add(new Cell('Statement', HEADER), new Cell('Status', HEADER), new Cell('Period', HEADER));
  for (const s of group.statements) {
    const st = group.status(s);
    const reason = group.leftOutReason(s);
    proof.add(basename(s.name),
      new Cell(reason ? 'LEFT OUT' : group.isPartial(s) ? 'PARTIAL - see Rows to check' : st.toUpperCase(),
        reason || st === 'red' ? BAD : PLAIN),
      `${s.facts.period_from} to ${s.facts.period_to}` + (reason ? ` - ${reason}` : ''));
  }
  if (group.excluded().length) {
    proof.add(new Cell('LEFT OUT statements are NOT in this file - see the reason ' +
      'beside each, fix it, then run the batch again.', BAD));
  }

  proof.add('');
  proof.add(new Cell('Batch check', HEADER), new Cell('Result', HEADER), new Cell('Detail', HEADER));
  for (const [label, passed, detail] of group.checks) {
    proof.add(label, passed ? new Cell('PASS', PLAIN) : new Cell('FAIL', BAD), new Cell(detail, passed ? PLAIN : BAD));
  }
  return proof;
}

// <BANK>_<last 4 digits>_<YYYYMM-YYYYMM>_BKTRN.xlsx
export function expressFileName(group) {
  const kept = group.statements.filter(s => !group.leftOutReason(s));
  const use = kept.length ? kept : group.statements;
  const first = use[0].bounds, last = use[use.length - 1].bounds;
  const ym = iso => iso.slice(0, 4) + iso.slice(5, 7);
  const span = first && last ? `${ym(first[0])}-${ym(last[1])}` : 'period-unknown';
  const tail = group.account
    ? group.account.replace(/\D/g, '').slice(-4)
    : basename(group.statements[0].name).replace(/\.[^.]*$/, '');
  return `${group.profile.key.toUpperCase()}_${tail}_${span}_BKTRN.xlsx`;
}

export const reviewFileName = name => `${basename(name).replace(/\.[^.]*$/, '')}.xlsx`;

// One combined Express file per account group. A group with no rows to import
// (every month failed or was left out) gets a reason instead of a file.
// Decision B: the rows a partial statement kept OUT of this file, with where to
// find each one - the photo page - and why it could not be proved.
export function buildRowsToCheck(group) {
  const sheet = new Sheet('Rows to check', { widths: [24, 11, 12, 30, 14, 14, 15, 46], freezeRows: 2 });
  sheet.add(new Cell('These rows are NOT in this file. Check each against the photo, then key it into Express by hand. ' +
    'Until they are in, the month will not balance. If it still does not balance after that, a row may have been ' +
    'missed completely - look near the listed photo pages for a line that is not on this sheet.', BAD));
  sheet.add(...['Statement', 'Photo page', 'Date', 'Description', 'Withdrawal (as read)', 'Deposit (as read)',
    'Balance (as read)', 'Why it is not in the file'].map(h => new Cell(h, HEADER)));
  for (const s of group.partials()) {
    for (const r of rowsToCheck(s)) {
      const amount = v => (v !== null && v !== undefined ? money(v, MONEY) : new Cell('', MONEY));
      // Not proved, so the balance never said which way it went - a passbook's
      // printed + or - does, as read.
      let { withdrawal, deposit } = r;
      if (withdrawal === null && deposit === null && r.amount !== null && r.printedSign) {
        if (r.printedSign === '-') withdrawal = r.amount; else deposit = r.amount;
      }
      const at = s.rows.indexOf(r);
      const last = at === s.rows.length - 1 && !s.checks.some(([label]) => /^Final balance matches/.test(label));
      const aboveUnproved = at === 0 ? s.facts.opening_derived : !s.rows[at - 1].verified;
      sheet.add(basename(s.name), new Cell(r.page ?? '', PLAIN), r.date, r.description,
        amount(withdrawal), amount(deposit), amount(r.balance),
        new Cell(r.notes.length ? r.notes.join('; ')
          : r.verified && aboveUnproved ? 'the line above could not be proved, so the balance this amount was checked ' +
            'against is not proved either - check the amount against the photo'
          : r.verified && last ? 'the last line: nothing after it confirms its balance - check the amount and the ' +
            'balance against the photo'
          : r.verified ? 'its amount agrees with its balance, but the row after it does not confirm that balance - ' +
            'check both the amount and the balance against the photo'
          : 'not confirmed by the running balance', BAD));
    }
  }
  return sheet;
}

export function expressFiles(groups) {
  return groups.map(group => {
    const rows = group.expressRows();
    if (!rows.length) {
      const reasons = group.statements.map(s => `${basename(s.name)}: ${group.leftOutReason(s) ?? 'no rows'}`);
      return { group, refused: `nothing to import - ${reasons.join('; ')}` };
    }
    const wd = rows.reduce((a, r) => a + (r.withdrawal ?? 0), 0);
    const dep = rows.reduce((a, r) => a + (r.deposit ?? 0), 0);
    const sheets = [buildBktrn(rows, group.profile.remarkFields), buildReadFirst(), buildBatchProof(group, wd, dep)];
    if (group.partials().length) sheets.push(buildRowsToCheck(group));
    return { group, fileName: expressFileName(group), sheets, bytes: writeXlsx(sheets),
      n: rows.length, wd, dep };
  });
}
