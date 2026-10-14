// The downloaded Excel files in Thai, worked out just before they are saved.
// The engine keeps writing them in English: the release gate compares its
// files with the answer key word for word, and the checks never change here.
//
// Only OUR words are translated, sheet by sheet and column by column. Never:
//  - the Express template's own parts (sheet BKTRN rows 1-3, sheet อ่านก่อน):
//    Express reads them, and they are Thai already;
//  - anything read from a statement (dates, descriptions, amounts, names).
import { Cell } from './engine/output/xlsx.js';
import { thai } from './lang.js';

// Fixed labels: the whole cell, exactly.
const FIXED = {
  // Review file - Transactions / Daily
  'Date': 'วันที่', 'Time': 'เวลา', 'Description': 'รายการ', 'Withdrawal': 'ถอน', 'Deposit': 'ฝาก',
  'Balance': 'ยอดคงเหลือ', 'Channel': 'ช่องทาง', 'Details': 'รายละเอียด', 'Check': 'ผลตรวจ',
  'Photo page': 'หน้ารูป', 'Opening balance': 'ยอดยกมา', 'Closing balance': 'ยอดคงเหลือปลายงวด',
  'Transactions': 'จำนวนรายการ', 'Withdrawals': 'ถอน', 'Deposits': 'ฝาก', 'Net change': 'เปลี่ยนแปลงสุทธิ',
  'OK': 'ผ่าน', 'PASS': 'ผ่าน', 'FAIL': 'ไม่ผ่าน',
  // Proof sheets
  'How this file was checked': 'ไฟล์นี้ตรวจอย่างไร', 'Source PDF': 'ไฟล์ PDF ต้นทาง', 'Bank': 'ธนาคาร',
  'Account name': 'ชื่อบัญชี', 'Account number': 'เลขที่บัญชี', 'Branch': 'สาขา',
  'Statement period': 'งวดใบแจ้งยอด', 'Transactions read': 'จำนวนรายการที่อ่านได้',
  'Result': 'ผล', 'Detail': 'รายละเอียด',
  'The rule every row is tested against': 'กฎที่ใช้ตรวจทุกรายการ',
  "this row's balance = last row's balance + deposit - withdrawal":
    'ยอดคงเหลือรายการนี้ = ยอดคงเหลือรายการก่อน + ฝาก - ถอน',
  'Dates are real Excel dates shown as DD/MM/YYYY (Western years), the same as the Express template. The format is fixed in the file, so a Thai Windows setting cannot turn them into Buddhist years.':
    'วันที่เป็นวันที่จริงของ Excel แสดงแบบ วว/ดด/ปปปป (ปี ค.ศ.) เหมือนแม่แบบ Express รูปแบบนี้กำหนดไว้ในไฟล์ การตั้งค่า Windows ภาษาไทยจึงเปลี่ยนเป็นปี พ.ศ. ไม่ได้',
  'Express import file - ฝาก-ถอนเงิน (BKTRN), several statements': 'ไฟล์นำเข้า Express - ฝาก-ถอนเงิน (BKTRN) รวมหลายใบแจ้งยอด',
  'Statements in this file': 'จำนวนใบแจ้งยอดในไฟล์นี้', 'Month in this file': 'เดือนในไฟล์นี้', 'Rows in this file': 'จำนวนรายการในไฟล์นี้',
  'Withdrawals (ถอน)': 'ยอดรวมถอน', 'Deposits (ฝาก)': 'ยอดรวมฝาก',
  'Before importing': 'ก่อนนำเข้า', '1. Fill every YELLOW cell': '1. กรอกทุกช่องสีเหลือง',
  'DOCNUM and BNKACC': 'DOCNUM และ BNKACC',
  '2. Delete columns G and H (ถอน, ฝาก)': '2. ลบคอลัมน์ G และ H (ถอน, ฝาก)',
  'they are for checking only': 'ใช้สำหรับตรวจเท่านั้น',
  'Statement': 'ใบแจ้งยอด', 'Status': 'สถานะ', 'Period': 'งวด',
  'GREEN': 'เขียว - ตรวจครบและยืนยันแล้ว', 'YELLOW': 'เหลือง - ยอดเงินตรวจแล้ว ให้ตรวจวันที่และรายละเอียดด้วยตา',
  'RED': 'แดง - มีการตรวจไม่ผ่าน', 'LEFT OUT': 'ตัดออก',
  'PARTIAL - see Rows to check': 'ตรวจได้บางส่วน - ดูชีต "รายการที่ต้องตรวจ"',
  'LEFT OUT statements are NOT in this file - see the reason beside each, fix it, then run the batch again.':
    'ใบแจ้งยอดที่ "ตัดออก" ไม่อยู่ในไฟล์นี้ - ดูเหตุผลข้าง ๆ แก้ไข แล้วทำใหม่อีกครั้ง',
  'Batch check': 'การตรวจรวมทุกใบ',
  '(not read)': '(อ่านไม่ได้)', '(not read - this file holds one statement)': '(อ่านไม่ได้ - ไฟล์นี้มีใบแจ้งยอดใบเดียว)',
  // the caveats, written "English / ไทย": the Thai half
  'READ FROM A PHOTO - compare dates and descriptions to the photo by eye / อ่านจากรูปถ่าย - ตรวจวันที่และรายละเอียดเทียบกับรูปด้วยตา':
    'อ่านจากรูปถ่าย - ตรวจวันที่และรายละเอียดเทียบกับรูปด้วยตา',
  // Rows to check
  'These rows are NOT in this file. Check each against the photo, then key it into Express by hand. Until they are in, the month will not balance. If it still does not balance after that, a row may have been missed completely - look near the listed photo pages for a line that is not on this sheet.':
    'รายการเหล่านี้ไม่อยู่ในไฟล์นำเข้า ตรวจแต่ละรายการเทียบกับรูป แล้วบันทึกใน Express เอง ยอดของเดือนจะไม่ลงตัวจนกว่าจะบันทึกครบ ถ้าบันทึกแล้วยังไม่ลงตัว อาจมีรายการที่อ่านตกไปทั้งบรรทัด - ดูรอบ ๆ หน้ารูปที่ระบุ หาบรรทัดที่ไม่อยู่ในชีตนี้',
  'Withdrawal (as read)': 'ถอน (ตามที่อ่านได้)', 'Deposit (as read)': 'ฝาก (ตามที่อ่านได้)',
  'Balance (as read)': 'ยอดคงเหลือ (ตามที่อ่านได้)', 'Why it is not in the file': 'เหตุผลที่ไม่อยู่ในไฟล์',
};
const SHEET = { Transactions: 'รายการ', Daily: 'รายวัน', Proof: 'การตรวจสอบ', 'Rows to check': 'รายการที่ต้องตรวจ' };

// Notes the Rows to check sheet writes itself (engine/output/express.js).
const WHY = [
  [/^this file does not carry on from the one before it \(one missing, out of order, or pictures that overlap\), so nothing from it was sent - check its rows against the original$/,
    'ไฟล์นี้ไม่ต่อจากไฟล์ก่อนหน้า (ขาดไป สลับลำดับ หรือรูปซ้อนกัน) จึงไม่ส่งรายการใดจากไฟล์นี้ - ตรวจรายการกับต้นฉบับ'],
  [/^not linked to the opening or closing balance typed in by an unbroken run of proved lines \(a line that does not add up, or a balance of exactly 0, breaks the run\) - check it against the original$/,
    'ยังไม่เชื่อมกับยอดยกมาหรือยอดคงเหลือปลายงวดที่กรอกไว้ด้วยบรรทัดที่ตรวจผ่านต่อเนื่องกัน (บรรทัดที่ไม่ลงตัว หรือยอดคงเหลือเป็น 0 พอดี ทำให้ขาดช่วง) - ตรวจกับต้นฉบับ'],
  [/^the first line: the opening balance it was checked against was read, not proved - check the amount against the photo$/,
    'บรรทัดแรก: ยอดยกมาที่ใช้ตรวจเป็นยอดที่อ่านได้ ยังไม่ได้ยืนยัน - ตรวจจำนวนเงินกับรูป'],
  [/^the line above could not be proved, so the balance this amount was checked against is not proved either - check the amount against the photo$/,
    'บรรทัดบนตรวจไม่ผ่าน ยอดคงเหลือที่ใช้ตรวจจำนวนเงินนี้จึงยังไม่ได้ยืนยัน - ตรวจจำนวนเงินกับรูป'],
  [/^the last line: nothing after it confirms its balance - check the amount and the balance against the photo$/,
    'บรรทัดสุดท้าย: ไม่มีบรรทัดถัดไปยืนยันยอดคงเหลือ - ตรวจจำนวนเงินและยอดคงเหลือกับรูป'],
  [/^its amount agrees with its balance, but the row after it does not confirm that balance - check both the amount and the balance against the photo$/,
    'จำนวนเงินตรงกับยอดคงเหลือ แต่รายการถัดไปไม่ยืนยันยอดคงเหลือนั้น - ตรวจทั้งจำนวนเงินและยอดคงเหลือกับรูป'],
  [/^not confirmed by the running balance$/, 'ยอดคงเหลือไม่ยืนยันรายการนี้'],
];

const UNTESTED = /^UNTESTED BANK - .* \/ (.+)$/;

function our(text) {
  const s = String(text);
  if (FIXED[s] !== undefined) return FIXED[s];
  const untested = UNTESTED.exec(s);
  if (untested) return untested[1];
  let m;
  if ((m = /^(\d+) row\(s\) flagged$/.exec(s))) return `มีรายการต้องตรวจ ${m[1]} รายการ`;
  if ((m = /^(\d+) days, (\d+) active$/.exec(s))) return `${m[1]} วัน มีรายการ ${m[2]} วัน`;
  // a statement period: two dates (or None, when one was not read)
  const D = '(\d[\d/-]*|None)';
  if ((m = new RegExp(`^${D} to ${D}$`).exec(s))) return `${m[1]} ถึง ${m[2]}`;
  if ((m = new RegExp(`^${D} to ${D} - (.+)$`).exec(s))) return `${m[1]} ถึง ${m[2]} - ${our(m[3])}`;
  for (const [re, th] of WHY) if (re.test(s)) return th;
  return s.split('; ').map(clause => thai(clause)).join('; ');
}

const swap = (row, c, fn) => {
  const cell = row[c];
  if (!cell || cell.kind !== 'text' || !String(cell.value).trim()) return;
  row[c] = new Cell(fn(cell.value), cell.style, cell.kind);
};

/** The sheets with our words in Thai (changed in place, and returned). */
export function thaiSheets(sheets) {
  for (const sheet of sheets) {
    const rows = sheet.rows;
    if (sheet.name === 'Transactions') {
      rows[0]?.forEach((_, c) => swap(rows[0], c, our));
      // the first and last lines are ours (opening, closing); the rest are the statement's
      for (const r of [1, rows.length - 1]) if (r > 0) swap(rows[r], 2, v => (/^(Opening|Closing) balance$/.test(v) ? FIXED[v] : v));
      for (const row of rows.slice(1)) swap(row, 8, our);
    } else if (sheet.name === 'Daily') {
      rows[0]?.forEach((_, c) => swap(rows[0], c, our));
      for (const row of rows.slice(1)) { swap(row, 6, our); swap(row, 0, v => (/ days, /.test(v) ? our(v) : v)); }
    } else if (sheet.name === 'Proof') {
      // column A: our labels and checks; B: results; C: details - with values
      // read from the statement (bank, name, account) left as they are
      for (const row of rows) {
        swap(row, 0, our);
        swap(row, 1, our);
        swap(row, 2, our);
      }
    } else if (sheet.name === 'Rows to check') {
      swap(rows[0], 0, our);
      rows[1]?.forEach((_, c) => swap(rows[1], c, our));
      for (const row of rows.slice(2)) swap(row, 7, our);
    } else continue;                     // BKTRN and อ่านก่อน: the template's, untouched
    sheet.name = SHEET[sheet.name] ?? sheet.name;
  }
  return sheets;
}
