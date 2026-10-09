// What the result screen shows, worked out from a finished run - pure, no
// browser code, so it can be tested. app.js builds `results` from the engine
// and draws what summarise() returns.
//
// results = {
//   groups: [{ bank, account, untested, statuses: ['green'|'yellow'|'red', ...],
//              statements: [{ name, period, rows, status, leftOut }],
//              checks: [[label, passed, detail], ...],
//              express: { fileName, rows } | { refused },
//              reviews: [fileName, ...] }],
//   refusals: [{ name, code, message }],
// }

// Plain-language reasons a file could not be used (StatementError codes).
export const MESSAGES = {
  'locked': {
    th: 'ไฟล์นี้ล็อกด้วยรหัสผ่าน ใส่รหัสผ่านในช่องด้านบน',
    en: 'This file is locked with a password. Type it in the box above.',
  },
  'wrong-password': {
    th: 'รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง',
    en: 'That password is not right. Try again.',
  },
  'not-pdf': {
    th: 'ไฟล์นี้ไม่ใช่ PDF ที่เปิดได้ (เช่น รูปภาพ หรือไฟล์ Excel)',
    en: 'This is not a PDF that can be opened (for example a photo or an Excel file).',
  },
  'no-text': {
    th: 'PDF นี้เป็นรูปภาพล้วน (ไฟล์สแกน) กด "อ่านเป็นรูปถ่าย" เพื่ออ่านจากรูป',
    en: 'This PDF is pictures only (a scan). Press "Read it as photos" to read it from the pictures.',
  },
  'summary-only': {
    th: 'มีแต่หน้าสรุปบัญชี ไม่มีหน้ารายการเดินบัญชี ถ่ายหน้ารายการมาด้วย',
    en: 'Only the account summary page was given - add the pages with the transactions.',
  },
  'mixed-banks': {
    th: 'รูปชุดนี้มาจากใบแจ้งยอดต่างธนาคารกัน ส่งทีละใบแจ้งยอด',
    en: 'These photos are from statements of different banks. Send one statement at a time.',
  },
  'unknown-bank': {
    th: 'อ่านรูปแบบใบแจ้งยอดนี้ไม่ได้ ยังไม่รู้จักธนาคารนี้ และตารางไม่ใช่แบบง่าย',
    en: "This statement's layout could not be read: the bank is not known yet and its table is not a simple one.",
  },
  'too-blurry': {
    th: 'ถ่ายใกล้ขึ้น ถ่ายจากกระดาษ วางราบ สว่าง เต็มกรอบ ห้ามถ่ายจากหน้าจอ',
    en: 'Too small or blurry to read. Take the photo closer, of the PAPER statement, flat and bright, ' +
      'filling the frame. Never photograph a screen - ask the client for the bank PDF instead.',
  },
  'unknown-layout': {
    th: 'หาหัวคอลัมน์ของธนาคารในรูปไม่พบ หรือธนาคารนี้ยังไม่มีรูปแบบในระบบ ถ่ายใหม่ให้เห็นหัวตารางชัดเจน',
    en: "Could not find this bank's column headings in the photo, or this bank has no layout on file yet. " +
      'Retake it with the table headings clearly in the frame.',
  },
  'heic': {
    th: 'กรุณาส่งรูปเป็น JPEG (LINE ส่งเป็น JPEG อยู่แล้ว)',
    en: 'Please use JPEG photos (LINE already sends JPEG). iPhone HEIC photos cannot be opened here.',
  },
  'not-image': {
    th: 'เปิดรูปนี้ไม่ได้ ใช้ไฟล์ JPG หรือ PNG',
    en: 'This picture could not be opened. Use a JPG or PNG file.',
  },
  'not-table': {
    th: 'เปิดไฟล์นี้เป็นตาราง Excel หรือ CSV ไม่ได้',
    en: 'This file could not be opened as an Excel (.xlsx) or CSV table.',
  },
  'old-xls': {
    th: 'ไฟล์ .xls แบบเก่าเปิดไม่ได้ เปิดใน Excel แล้วบันทึกเป็น .xlsx',
    en: 'Old .xls files cannot be opened here. Open it in Excel and save it as .xlsx.',
  },
  'too-big': {
    th: 'ไฟล์นี้ใหญ่หรือกว้างเกินกว่าใบแจ้งยอดปกติ (เกิน 20 MB, 256 คอลัมน์ หรือ 20,000 แถว) จึงไม่เปิด',
    en: 'This file is larger than any statement page (over 20 MB, 256 columns or 20,000 rows), so it was not opened.',
  },
  'date-1904': {
    th: 'ไฟล์นี้ใช้การนับวันที่แบบปี 1904 (Excel บน Mac รุ่นเก่า) วันที่จะผิดไป 4 ปี เปิดใน Excel แล้วบันทึกเป็น CSV แล้วเลือกไฟล์ CSV แทน',
    en: 'This file counts dates from 1904 (old Mac Excel), so its dates would read 4 years early. Open it in Excel, save it as CSV, and choose the CSV instead.',
  },
  'same-file': {
    th: 'ไฟล์นี้เหมือนกับไฟล์ที่เลือกไว้แล้ว จึงไม่เพิ่มซ้ำ',
    en: 'This file is the same as one already chosen, so it was not added again.',
  },
  'need-typed': {
    th: 'พิมพ์ยอดยกมา หรือยอดคงเหลือปลายงวด (หรือทั้งสอง) จากใบแจ้งยอดจริงก่อน เพื่อให้ตรวจได้ว่ายอดติดลบหรือไม่',
    en: 'Type the opening or the closing balance (or both) from the paper statement first, so the tool can tell an overdrawn account from one in credit.',
  },
  'bad-typed': {
    th: 'อ่านยอดยกมา/ยอดคงเหลือปลายงวดที่พิมพ์ไม่ได้ พิมพ์แบบ 1,234.50 (ติดลบใส่ - ข้างหน้า) หรือเว้นว่าง',
    en: 'A typed opening or closing balance could not be read. Type it like 1,234.50 (a minus in front if overdrawn), or leave it blank.',
  },
  'no-balance': {
    th: 'ต้องเลือกคอลัมน์วันที่ ยอดคงเหลือ และจำนวนเงิน (ถอน/ฝาก หรือ จำนวนเงิน) ก่อน',
    en: 'Choose the date, balance and amount columns (withdrawal/deposit, or one amount column) first.',
  },
  'not-passbook': {
    th: 'ไม่พบบรรทัดรายการของสมุดบัญชีกรุงไทยในไฟล์นี้ สแกนหน้าที่พิมพ์รายการ ให้เรียบและเต็มหน้า',
    en: 'No Krungthai passbook lines were found. Scan the printed pages, flat and whole.',
  },
  'refused': {
    th: 'อ่านใบแจ้งยอดนี้อย่างปลอดภัยไม่ได้ จึงไม่ได้สร้างไฟล์',
    en: 'This statement could not be read safely, so no file was made from it.',
  },
};

// The fixed status words (Global Constraints).
export const STATUS_TEXT = {
  green: { icon: '🟢', en: 'Proved and confirmed', th: 'ตรวจครบและยืนยันแล้ว' },
  yellow: { icon: '🟡', en: 'Proved, nothing independent confirms it - amounts proved; check dates and descriptions by eye',
    th: 'ยอดเงินตรวจแล้ว โปรดตรวจวันที่และรายละเอียดด้วยตา' },
  // Decision B: a photo statement whose proved rows go to Express, the rest listed.
  partial: { icon: '🟠', en: 'Partly proved - the proved rows go to Express; check the listed rows by hand',
    th: 'ตรวจได้บางส่วน - รายการที่ตรวจแล้วเข้า Express; รายการที่เหลือตรวจเองตามรายการที่แจ้ง' },
  red: { icon: '🔴', en: 'A check failed - Review file only, no Express file for that month',
    th: 'มีการตรวจที่ไม่ผ่าน - เดือนนั้นมีเฉพาะไฟล์ตรวจสอบ ไม่มีไฟล์ Express' },
  blocked: { icon: '⛔', en: 'Nothing could be read', th: 'อ่านไฟล์ไม่ได้' },
};

// Decision B (Co 2026-10-07): a photo statement with some rows unproved.
export const PARTIAL_TEXT = {
  en: p => `${p.toExpress} proved rows go to Express; ${p.toCheck} row(s) to check by hand` +
    (p.pages.length ? ` on page ${p.pages.join(', ')}` : '') + ' - listed on the "Rows to check" sheet',
  th: p => `${p.toExpress} รายการตรวจแล้วเข้า Express; ${p.toCheck} รายการต้องตรวจเอง` +
    (p.pages.length ? ` (หน้า ${p.pages.join(', ')})` : '') + ' ดูชีต "Rows to check"',
};

export const UNTESTED_TEXT = {
  en: 'This bank has not been tested yet. Amounts are proved by the balance; check dates and descriptions by eye.',
  th: 'ธนาคารนี้ยังไม่ได้ทดสอบ ยอดเงินตรวจด้วยยอดคงเหลือแล้ว โปรดตรวจวันที่และรายละเอียดด้วยตา',
};

export const PHOTO_TEXT = {
  en: 'Read from a photo. Amounts are proved by the balance; compare dates and descriptions to the photo by eye.',
  th: 'อ่านจากรูปถ่าย ยอดเงินตรวจด้วยยอดคงเหลือแล้ว โปรดตรวจวันที่และรายละเอียดเทียบกับรูปด้วยตา',
};

const RANK = { green: 0, yellow: 1, partial: 2, red: 3 };
const worst = statuses => statuses.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), 'green');

// Screens get shared and photographed: show only the last 4 digits.
export function maskAccount(account) {
  if (!account) return '(account number not read)';
  return `•••• ${String(account).replace(/\D/g, '').slice(-4)}`;
}

export function summarise(results) {
  const accounts = results.groups.map(g => ({
    bank: g.bank ?? '',
    account: maskAccount(g.account),
    untested: Boolean(g.untested),
    photo: Boolean(g.photo),
    status: worst(g.statuses),
    statements: g.statements ?? [],
    checks: g.checks ?? [],
    express: g.express,
    reviews: g.reviews ?? [],
  }));
  const refusals = results.refusals.map(r => {
    const text = MESSAGES[r.code] ?? MESSAGES.refused;
    return { name: r.name, code: r.code, th: text.th, en: text.en, detail: r.message ?? '' };
  });
  const downloads = [];
  for (const a of accounts) {
    if (a.express?.fileName) downloads.push({ fileName: a.express.fileName, kind: 'express' });
    for (const fileName of a.reviews) downloads.push({ fileName, kind: 'review' });
  }
  const banner = accounts.length ? worst(accounts.map(a => a.status)) : 'blocked';
  return { banner, accounts, refusals, downloads };
}
