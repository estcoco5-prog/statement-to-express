// The per-bank reading rules. The personal-account forms (KBANK ... BBL_REPORT
// below) are a value-for-value copy of the private answer key's bank_profiles.py
// (generated from it, so no Thai label was retyped); see bank_profiles.py for
// each measurement. The BUSINESS forms at the end (Co 2026-10-16) exist here
// only: each is checked against the bank's own CSV export and printed totals.
// Every column bound is in PDF points from the left page edge, measured on a
// real statement of that bank.
// A word belongs to the column its CENTRE falls in (lo inclusive, hi exclusive).

export const col = (name, lo, hi) => ({ name, lo, hi });

// amountSplitX null (the general reader): which amount column is which is not
// known, so there is no position cross-check - the balance alone decides.
// wrapReach null: a dateless, balanceless line continues the row above, down
// to the footer marks. A number of points (the general reader, which knows no
// footer marks): it must also start within that distance below the line above
// it, and add a letter or digit to the row's text (a line of dashes is a
// ruler) - after a bigger gap, or at a ruled line,
// the table has ended.
export function profile(p) {
  const marks = { total_items: [], totals_line: [], ...p.marks };
  return { dateOrder: 'dmy', dateStyle: 'numeric', balanceEveryRow: true,
           openingPrinted: true, remarkFields: null, untested: false, wrapReach: null, codeNames: {},
           newestFirst: false, signedAmounts: false, timeSeconds: false,
           // business forms (Co 2026-10-16), all off for the personal forms:
           signedBalances: false,   // an overdrawn balance printed "-1,234.56"
           depositFirst: false,     // the deposit column sits LEFT of the withdrawal column
           normDate: null,          // a row's date as printed -> "dd/mm/yyyy" (or unchanged)
           yearsFourDigit: false,   // 4-digit years say Western or Buddhist alone (no period printed)
           periodFromRows: false,   // no period printed: the first and last lines' dates stand in
           wrapNearest: null,       // points: a wrapped line belongs to the NEAREST row, above or below
           leadChannel: false,      // the channel prints first and again inside the description
           wrapStrip: [],           // labels dropped from wrapped detail lines ("Account Name:")
           legendRe: null,          // a printed code legend ("BPKB - DEPOSIT THRU ...") names the codes
           patterns: [],            // [{ re, keys }]: facts read off the header/footer text
           ...p, marks };
}

// Is an amount printed at right edge x1 in the withdrawal column?
export const inWithdrawalColumn = (x1, p) => (p.depositFirst ? x1 >= p.amountSplitX : x1 < p.amountSplitX);

const KBANK = profile({
  key: "kbank", bank: "KBank (ธนาคารกสิกรไทย)",
  // Column headings measured on the real PDF (tools/measure-anchors.mjs): the
  // photo reader lines a photo up by these.
  anchors: [{ text: "ถอนเงิน", x0: 213.3, y0: 174.7 }, { text: "ยอดคงเหลือ", x0: 285.9, y0: 169.0 }, { text: "ช่องทาง", x0: 357.6, y0: 174.7 }, { text: "รายละเอียด", x0: 454.9, y0: 174.7 }],
  columns: [
    col("date", 60.0, 95.0),
    col("time", 95.0, 121.0),
    col("description", 121.0, 210.0),
    col("amount", 210.0, 280.0),
    col("balance", 280.0, 332.0),
    col("channel", 332.0, 402.0),
    col("details", 402.0, 560.0),
  ],
  amountSplitX: 258.0,
  remarkFields: ["details"],
  marks: {
    identify: ["KBPDF", "FM702-CA_SA", "K-BIZ Contact Center"],
    opening: ["ยอดยกมา"],
    closing: ["ยอดยกไป"],
    total_withdraw: ["รวมถอนเงิน"],
    total_deposit: ["รวมฝากเงิน"],
    period: ["รอบระหว่างวันที่"],
    account_no: ["เลขที่บัญชีเงินฝาก"],
    account_name: ["ชื่อบัญชี"],
    branch: ["สาขาเจ้าของบัญชี"],
    footer: ["KBPDF", "สอบถามข้อมูลเพิ่มเติม", "ออกโดย"],
    furniture_text: ["หน้าที่", "เลขที่อ้างอิง", "ยอดยกไป", "ยอดยกมา", "รวมถอนเงิน", "รวมฝากเงิน", "รอบระหว่างวันที่", "เลขที่บัญชีเงินฝาก", "ชื่อบัญชี", "สาขาเจ้าของบัญชี", "ยอดคงเหลือ", "ช่องทาง", "รายละเอียด", "KBPDF", "FM702-CA_SA", "ออกโดย", "สอบถามข้อมูลเพิ่มเติม"],
  },
});

const SCB = profile({
  key: "scb", bank: "SCB (ธนาคารไทยพาณิชย์)",
  // Column headings measured on the real PDF (tools/measure-anchors.mjs): the
  // photo reader lines a photo up by these.
  anchors: [{ text: "Date", x0: 36.4, y0: 184.0 }, { text: "Channel", x0: 121.6, y0: 184.0 }, { text: "Balance/Baht", x0: 326.6, y0: 184.0 }, { text: "Description", x0: 468.5, y0: 184.0 }],
  columns: [
    col("date", 25.0, 60.0),
    col("time", 60.0, 85.0),
    col("channel", 85.0, 115.0),
    col("channel", 115.0, 190.0),
    col("amount", 190.0, 310.0),
    col("balance", 310.0, 393.0),
    col("description", 393.0, 560.0),
  ],
  amountSplitX: 265.0,
  marks: {
    identify: ["THE SIAM COMMERCIAL BANK PUBLIC COMPANY LIMITED"],
    opening: ["ยอดเงินคงเหลือยกมา", "BALANCE BROUGHT FORWARD"],
    closing: [],
    total_withdraw: ["(Debit)"],
    total_deposit: ["(Credit)"],
    total_items: ["TOTAL ITEMS"],
    period: ["วันที่"],
    account_no: ["เลขที่บัญชี"],
    account_name: ["สกุล"],
    branch: ["สาขา"],
    footer: ["TOTAL", "เอกสารฉบับนี้ออกโดยระบบอัตโนมัติ"],
    furniture_text: ["BROUGHT FORWARD", "TOTAL AMOUNTS", "TOTAL ITEMS", "Balance/Baht", "Debit/Credit", "ลูกหนี้/เจ้าหนี้", "ยอดเงินคงเหลือ", "เลขที่บัญชี", "STATEMENT OF", "เอกสารฉบับนี้", "auto-generated"],
  },
});

const KTB = profile({
  key: "ktb", bank: "KTB (ธนาคารกรุงไทย)",
  // Column headings measured on the real PDF (tools/measure-anchors.mjs): the
  // photo reader lines a photo up by these.
  anchors: [{ text: "วันที่/เวลา", x0: 39.7, y0: 233.0 }, { text: "รายการถอน", x0: 341.3, y0: 233.0 }, { text: "รายการฝาก", x0: 404.6, y0: 233.0 }, { text: "ยอดเงินคงเหลือ", x0: 471.1, y0: 233.0 }, { text: "สาขา", x0: 541.9, y0: 233.0 }],
  columns: [
    col("date", 35.0, 80.0),
    col("description", 80.0, 205.0),
    col("details", 205.0, 340.0),
    col("amount", 340.0, 445.0),
    col("balance", 445.0, 530.0),
    col("channel", 530.0, 570.0),
  ],
  amountSplitX: 408.0,
  openingPrinted: false,
  remarkFields: ["description", "details"],
  marks: {
    identify: ["call.callcenter@krungthai.com"],
    opening: [],
    closing: [],
    total_withdraw: ["รายการถอนทั้งหมด"],
    total_deposit: ["รายการฝากทั้งหมด"],
    period: ["รายการบัญชีระหว่างวันที่"],
    account_no: ["เลขที่บัญชี"],
    account_name: ["ชื่อบัญชี"],
    branch: ["สาขา"],
    footer: ["จำนวนหน้าทั้งหมด", "รายการถอนทั้งหมด", "รายการฝากทั้งหมด", "ธนาคารกรุงไทย", "krungthai.com"],
    furniture_text: ["รายการเดินบัญชี", "วันที่/เวลา", "ยอดเงินคงเหลือ", "หมายเลขเช็ค", "ทั้งหมด", "krungthai.com", "เลขที่บัญชี", "ชื่อบัญชี"],
  },
});

const UOB = profile({
  key: "uob", bank: "UOB (ธนาคารยูโอบี)",
  // Column headings measured on the real PDF (tools/measure-anchors.mjs): the
  // photo reader lines a photo up by these.
  anchors: [{ text: "Description", x0: 149.0, y0: 178.0 }, { text: "Withdrawals", x0: 337.0, y0: 177.0 }, { text: "Deposits", x0: 426.0, y0: 177.0 }, { text: "Balance", x0: 517.0, y0: 177.0 }],
  columns: [
    col("date", 45.0, 100.0),
    col("value_date", 100.0, 147.0),
    col("description", 147.0, 335.0),
    col("amount", 335.0, 470.0),
    col("balance", 470.0, 560.0),
  ],
  amountSplitX: 419.0,
  dateStyle: "d_mon",
  balanceEveryRow: false,
  marks: {
    identify: ["Account Transaction Details"],
    // Photo sets include the account summary page (Co 2026-10-07): it carries
    // the period but no transaction table.
    summary_page: ["Account Overview", "End of Summary"],
    opening: ["BALANCE B/F"],
    closing: [],
    total_withdraw: [],
    total_deposit: [],
    totals_line: ["Total"],
    period: ["Period:"],
    account_no: ["ONE Account"],
    account_name: [],
    branch: [],
    footer: ["Total", "End of Transaction Details", "End of Summary"],
    furniture_text: ["Trans Date", "Value Date", "Withdrawals", "Deposits", "Balance", "End of", "Page"],
  },
});

const BBL = profile({
  key: "bbl", bank: "BBL (ธนาคารกรุงเทพ)",
  // Column headings measured on the real PDF (tools/measure-anchors.mjs): the
  // photo reader lines a photo up by these.
  anchors: [{ text: "Date", x0: 29.2, y0: 188.4 }, { text: "Particulars", x0: 80.0, y0: 188.4 }, { text: "Withdrawal", x0: 244.2, y0: 188.4 }, { text: "Deposit", x0: 327.4, y0: 188.4 }, { text: "Balance", x0: 396.6, y0: 188.4 }],
  columns: [
    col("date", 20.0, 55.0),
    col("description", 55.0, 160.0),
    col("details", 160.0, 240.0),
    col("amount", 240.0, 370.0),
    col("balance", 370.0, 430.0),
    col("channel", 430.0, 560.0),
  ],
  amountSplitX: 318.0,
  marks: {
    identify: ["Bangkok Bank Public Company Limited", "Bualuang Phone"],
    opening: ["B/F"],
    closing: [],
    total_withdraw: ["Total Debit Amount"],
    total_deposit: ["Total Credit Amount"],
    period: ["Statement Period"],
    account_no: ["เลขที่บัญชี/Account"],
    account_name: ["ชื่อ/Name"],
    branch: [],
    footer: ["Total No. of", "If no objection", "ถาไมมีการคัดคาน", "สอบถามขอมูล", "เงินฝากนี้ไดรับความคุมครอง"],
    furniture_text: ["Particulars", "Withdrawal", "Deposit", "Balance", "Statement Period", "Bangkok Bank", "Taxpayer", "Page", "หนาที่"],
  },
});

const KKP = profile({
  key: "kkp", bank: "KKP (ธนาคารเกียรตินาคินภัทร)",
  // Column headings measured on the real PDF (tools/measure-anchors.mjs): the
  // photo reader lines a photo up by these.
  anchors: [{ text: "Date", x0: 51.3, y0: 253.0 }, { text: "Description", x0: 101.6, y0: 253.0 }, { text: "Debit", x0: 185.9, y0: 253.0 }, { text: "Credit", x0: 252.4, y0: 253.0 }, { text: "Channel", x0: 402.7, y0: 253.0 }],
  columns: [
    col("date", 35.0, 83.0),
    col("description", 83.0, 165.0),
    col("amount", 165.0, 300.0),
    col("balance", 300.0, 391.0),
    col("channel", 391.0, 470.0),
    col("details", 470.0, 560.0),
  ],
  amountSplitX: 260.0,
  remarkFields: ["description", "channel", "details"],
  marks: {
    identify: ["P-S001217"],
    opening: ["ยอดยกมา"],
    closing: ["Outstanding Balance"],
    total_withdraw: [],
    total_deposit: [],
    period: ["รอบระหว่างวันที่"],
    account_no: ["เลขที่บัญชี"],
    account_name: [],
    branch: [],
    footer: ["END OF STATEMENT", "หมายเหตุ", "Remark:"],
    furniture_text: ["รายการเดินบัญชี", "Statement of", "Outstanding", "Balance", "Channel", "Details", "END OF STATEMENT", "Page", "P-S001217"],
  },
});


// Krungthai Corporate Online / Krungthai Business "historical" statement - a
// different form from the personal KTB one. Its pages are stored sideways
// (/Rotate 90): readWords turns them upright. The item counts print in a font
// whose digits do not decode, so only the totals and closing are read. Tax
// (withholding on interest) has its own column and is not part of the amount.
const KTB_CORP = profile({
  key: "ktbcorp", bank: "KTB Corporate (กรุงไทย ธุรกิจ)",
  // Column headings measured on the real PDF (tools/measure-anchors.mjs): the
  // photo reader lines a photo up by these.
  anchors: [{ text: "รายละเอียด", x0: 216.7, y0: 239.7 }, { text: "หมายเลขเช็ค", x0: 339.5, y0: 239.7 }, { text: "ภาษี", x0: 625.5, y0: 239.7 }, { text: "ยอดคงเหลือ", x0: 683.9, y0: 239.7 }, { text: "ช่องทาง", x0: 777.0, y0: 239.7 }],
  columns: [
    col("date", 0.0, 52.0),
    col("time", 52.0, 80.0),
    col("description", 80.0, 155.0),
    col("details", 155.0, 420.0),
    col("amount", 420.0, 625.0),
    col("tax", 625.0, 670.0),
    col("balance", 670.0, 758.0),
    col("channel", 758.0, 842.0),
  ],
  amountSplitX: 560.0,
  remarkFields: ["details"],
  // IIPS: posted at month end with exactly 1% tax withheld - deposit interest.
  // SDCH / SDTRC print no details either, but nothing says what they are.
  codeNames: { IIPS: "ดอกเบี้ยเงินฝาก" },
  marks: {
    identify: ["cash.management@krungthai.com"],
    opening: ["ยอดคงเหลือยกมา"],
    closing: ["ยอดยกไป"],
    total_withdraw: ["รายการถอนเงิน"],
    total_deposit: ["รายการฝากเงิน"],
    period: ["รายการระหว่างวัน"],
    account_no: ["บัญชี"],
    account_name: ["อบัญชี"],
    branch: [],
    footer: ["ยอดยกไป", "รายการถอนเงิน", "รายการฝากเงิน", "ธนาคารกรุงไทย", "krungthai.com"],
    furniture_text: ["รายการเดินบัญชี", "ยอดคงเหลือ", "หมายเลขเช็ค", "krungthai.com", "Corporate Call Center"],
  },
});

// BBL Transaction Report - Bangkok Bank's business internet banking report, a
// different form from the BBL statement (Co 2026-10-13). Newest line FIRST, no
// brought-forward line, no totals, debits printed with a minus, and the
// balance at the top is the PRINT-date balance (never read as the closing).
const BBL_REPORT = profile({
  key: "bblreport", bank: "BBL Transaction Report (ธนาคารกรุงเทพ)",
  // Column headings measured on the real PDF: the photo reader lines a photo up by these.
  anchors: [{ text: "Description", x0: 239.8, y0: 193.3 }, { text: "Debit", x0: 491.8, y0: 193.3 }, { text: "Credit", x0: 585.4, y0: 193.3 }, { text: "Channel", x0: 758.2, y0: 193.3 }],
  columns: [
    col("date", 30.0, 76.0),
    col("time", 76.0, 150.0),
    col("value_date", 150.0, 235.0),
    col("description", 235.0, 395.0),
    col("details", 395.0, 480.0),
    col("amount", 480.0, 680.0),
    col("balance", 680.0, 756.0),
    col("channel", 756.0, 850.0),
    col("details", 850.0, 1051.0),
  ],
  amountSplitX: 620.0,
  openingPrinted: false,
  newestFirst: true,
  signedAmounts: true,
  timeSeconds: true,
  remarkFields: ["description"],
  marks: {
    identify: ["Source Of Account"],
    opening: [],
    closing: [],
    total_withdraw: [],
    total_deposit: [],
    period: ["Period from"],
    account_no: ["Account Number"],
    account_name: ["Account Name"],
    branch: ["Bank Branch"],
    footer: ["Bangkok Bank Public Company Limited", "Created by", "Printed on", "Page no", "End of Report"],
    furniture_text: ["Transaction Date", "ChequeNo.", "Ledger Balance", "Created by", "Printed on", "Page no", "End of Report", "Transaction Report"],
  },
});

// ---- business-account forms (Co 2026-10-16) --------------------------------
// Measured on one client's June 2026 statements; each checked line by line
// against the bank's own CSV export where the bank gave one.

const THAI_MONTHS = { 'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12 };
// '01-มิ.ย.-2569' -> '01/06/2569' (K-BIZ)
function thaiMonthDate(text) {
  const m = /^(\d{1,2})-([ก-๙.]+)-(\d{4})$/.exec(text);
  const month = m && THAI_MONTHS[m[2]];
  return month ? `${m[1].padStart(2, '0')}/${String(month).padStart(2, '0')}/${m[3]}` : text;
}
// '01.06.2026' -> '01/06/2026' (ttb)
const dottedDate = text => (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(text) ? text.replace(/\./g, '/') : text);
const MONEY = '(-?[\\d,]+\\.\\d\\d)';

// SCB Business "Historical Statement" (รายการเดินบัญชีย้อนหลัง). A long
// description prints half ABOVE its line and half below, 5pt each way, so a
// wrapped line belongs to the nearest row. An overdrawn current account prints
// its balance with a minus.
const SCB_BIZ = profile({
  key: "scbbiz", bank: "SCB Business (ไทยพาณิชย์ ธุรกิจ)",
  // Column headings measured on the real PDF: the photo reader lines a photo up by these.
  anchors: [{ text: "Date/Time", x0: 23.0, y0: 210.1 }, { text: "Withdrawal", x0: 201.1, y0: 210.1 }, { text: "Balance", x0: 377.5, y0: 210.1 }, { text: "Description", x0: 409.0, y0: 210.1 }],
  columns: [
    col("date", 15.0, 64.0),
    col("time", 64.0, 88.0),
    col("channel", 88.0, 118.0),       // the transaction code (X1, X2, QW...)
    col("channel", 118.0, 150.0),
    col("details", 150.0, 198.0),      // cheque number
    col("amount", 198.0, 340.0),
    col("balance", 340.0, 407.0),
    col("description", 407.0, 600.0),
  ],
  amountSplitX: 266.0,
  signedBalances: true,
  wrapNearest: 12.0,
  remarkFields: ["description", "details"],
  patterns: [
    { re: /\(Start\):\s*(\d{2}\/\d{2}\/\d{4})/, keys: ["period_from"] },
    { re: /\(End\):\s*(\d{2}\/\d{2}\/\d{4})/, keys: ["period_to"] },
    { re: new RegExp(`จำนวนเงินนำเข้าบัญชีทั้งหมด\\n(\\d+) รายการ \\(Items\\) ${MONEY}`), keys: ["deposit_count", "deposit_total"] },
    { re: new RegExp(`จำนวนเงินที่หักบัญชีทั้งหมด\\n(\\d+) รายการ \\(Items\\) ${MONEY}`), keys: ["withdraw_count", "withdraw_total"] },
  ],
  marks: {
    // the title in both languages and SCB's business call centre (an apostrophe in
    // "SCB's" can print curly, so it is not relied on)
    identify: [["Historical Statement", "รายการเดินบัญชีย้อนหลัง", "02-722-2222"]],
    opening: ["ยอดยกมา"],
    closing: ["ยอดยกไป"],
    total_withdraw: [],
    total_deposit: [],
    period: [],
    account_no: ["เลขที่บัญชี:"],
    account_name: [],
    branch: [],
    footer: ["ยอดยกไป", "จำนวนเงินนำเข้าบัญชีทั้งหมด", "เอกสารนี้ไม่จำเป็นต้องมีลายเซ็น", "หน้าที่ (Page)"],
    furniture_text: ["Balance Forward", "Date/Time", "ยอดเงินหักบัญชี", "Historical Statement", "Withdrawal (Debit)"],
  },
});

// KBank K-BIZ statement (รายการเดินบัญชีเงินฝากกระแสรายวัน / ออมทรัพย์) - not the
// personal KBank form. One amount column: withdrawals end at x 333, deposits
// at x 364. Dates like 01-มิ.ย.-2569; no period is printed.
const KBIZ = profile({
  key: "kbiz", bank: "KBank K-BIZ (กสิกรไทย ธุรกิจ)",
  // Column headings measured on the real PDF: the photo reader lines a photo up by these.
  anchors: [{ text: "รายการ", x0: 150.0, y0: 170.8 }, { text: "เลขที่เช็ค", x0: 237.3, y0: 170.8 }, { text: "ถอนเงิน/ฝากเงิน", x0: 291.3, y0: 170.8 }, { text: "ยอดเงินคงเหลือ", x0: 376.1, y0: 170.8 }, { text: "ผู้ทำรายการ", x0: 482.6, y0: 170.8 }],
  columns: [
    col("date", 30.0, 86.0),
    col("description", 86.0, 232.0),
    col("details", 232.0, 285.0),      // cheque number
    col("amount", 285.0, 372.0),
    col("balance", 372.0, 437.0),
    col("channel", 437.0, 600.0),      // branch code, teller, time
  ],
  amountSplitX: 348.0,
  signedBalances: true,
  normDate: thaiMonthDate,
  yearsFourDigit: true,
  periodFromRows: true,
  remarkFields: ["description", "details"],
  marks: {
    identify: ["รวมรายการด้านการถอนเงิน", "รวมรายการด้านการฝากเงิน"],
    opening: ["ยอดยกมา"],
    closing: ["ยอดยกไป"],
    total_withdraw: ["รวมรายการด้านการถอนเงิน"],
    total_deposit: ["รวมรายการด้านการฝากเงิน"],
    period: [],
    account_no: ["เลขที่บัญชีเงินฝาก"],
    account_name: [],
    branch: ["สาขาเจ้าของบัญชี"],
    footer: ["ยอดยกไป", "รวมรายการด้าน", "วันที่-เวลา", "พิมพ์โดย", "K-BIZ Contact Center"],
    furniture_text: ["STATEMENT OF", "ยอดเงินคงเหลือ", "ผู้ทำรายการ", "พิมพ์โดย", "K-BIZ"],
  },
});

// ttb business one (รายการเคลื่อนไหวทางบัญชี). Dates 01.06.2026; the channel
// ("business one", "KBANK") prints first and again inside the description;
// the totals and closing are on the last page.
const TTB_BIZ = profile({
  key: "ttbbiz", bank: "ttb business one (ทีทีบี ธุรกิจ)",
  // Column headings measured on the real PDF: the photo reader lines a photo up by these.
  anchors: [{ text: "เลขที่เช็ค", x0: 238.1, y0: 261.0 }, { text: "ฝาก", x0: 400.3, y0: 261.0 }, { text: "ยอดคงเหลือ", x0: 517.3, y0: 257.7 }],
  columns: [
    col("date", 20.0, 76.0),
    col("time", 76.0, 118.0),
    col("description", 118.0, 330.0),
    col("amount", 330.0, 490.0),
    col("balance", 490.0, 570.0),
  ],
  amountSplitX: 440.0,
  signedBalances: true,
  timeSeconds: true,
  normDate: dottedDate,
  leadChannel: true,
  remarkFields: ["description"],
  patterns: [
    { re: /(\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})/, keys: ["period_from", "period_to"] },
    { re: /เลขที่บัญชี:[^\n]*\n[^\n]*?(\d{3} \d \d{5} \d)/, keys: ["account_no"] },
    { re: new RegExp(`ยอดรวมเงินถอนจากบัญชี:\\s*(\\d+)\\s+${MONEY}`), keys: ["withdraw_count", "withdraw_total"] },
    { re: new RegExp(`ยอดรวมเงินฝากเข้าบัญชี:\\s*(\\d+)\\s+${MONEY}`), keys: ["deposit_count", "deposit_total"] },
    { re: new RegExp(`เงินคงเหลือบัญชี ณ วันที่[^\\n]*\\n${MONEY}`), keys: ["closing_stated"] },
  ],
  marks: {
    identify: [["รายการเคลื่อนไหวทางบัญชี", "วันที่ออกใบแจ้งรายการ"]],
    opening: ["ยอดคงเหลือยกมา"],
    closing: [],
    total_withdraw: [],
    total_deposit: [],
    period: [],
    account_no: [],
    account_name: [],
    branch: [],
    footer: ["ยอดเงินคงเหลือยกไป", "พิมพ์โดย", "ยอดรวมเงินถอนจากบัญชี"],
    furniture_text: ["ยอดคงเหลือยกมา", "ยอดเงินคงเหลือยกไป", "วันที่ทำรายการ", "พิมพ์โดย"],
  },
});

// UOB corporate account statement ("Account Details" / "Movement Details").
// Deposits print LEFT of withdrawals, each row prints both (one is 0.00). The
// row's date is the STATEMENT date (Co 2026-10-16: the printed statement
// date, not the value date). The header's Ledger Balance is the balance on
// the PRINT date - never read as the closing.
const UOB_BIZ = profile({
  key: "uobbiz", bank: "UOB Business (ยูโอบี ธุรกิจ)",
  // Column headings measured on the real PDF: the photo reader lines a photo up by these.
  anchors: [{ text: "Value", x0: 93.0, y0: 346.6 }, { text: "Description", x0: 198.3, y0: 346.6 }, { text: "Deposit", x0: 303.6, y0: 346.6 }, { text: "Withdrawal", x0: 382.6, y0: 346.6 }, { text: "Balance", x0: 461.6, y0: 346.6 }],
  columns: [
    col("date", 30.0, 88.0),
    col("value_date", 88.0, 142.0),
    col("time", 142.0, 195.0),
    col("description", 195.0, 300.0),
    col("amount", 300.0, 450.0),
    col("balance", 450.0, 560.0),
  ],
  amountSplitX: 370.0,
  depositFirst: true,
  openingPrinted: false,
  signedBalances: true,
  timeSeconds: true,
  remarkFields: ["description"],
  patterns: [
    { re: new RegExp(`Total in Account Currency ${MONEY} ${MONEY}`), keys: ["deposit_total", "withdraw_total"] },
  ],
  marks: {
    identify: [["Movement Details", "Ledger Balance", "Total in Account Currency"]],
    opening: [],
    closing: [],
    total_withdraw: [],
    total_deposit: [],
    period: ["Movement Details"],
    account_no: ["Account"],
    account_name: [],
    branch: [],
    footer: ["Total in Account Currency", "Note:", "Balances and details"],
    furniture_text: ["Movement Details", "Ledger Balance", "Transaction Description"],
  },
});

// EXIM Bank (ธนาคารเพื่อการส่งออกและนำเข้าแห่งประเทศไทย). Its Thai prints with
// a broken font (เง)น), so it is told by its address and tax number; the
// rows are in English codes, named by the legend on the last page. No period.
const EXIM = profile({
  key: "exim", bank: "EXIM Bank (ธนาคารเพื่อการส่งออกฯ)",
  // Column headings measured on the real PDF: the photo reader lines a photo up by these.
  anchors: [{ text: "เดือน", x0: 37.1, y0: 175.2 }, { text: "รายการ", x0: 85.7, y0: 175.2 }, { text: "เลขที่อางอิง", x0: 164.7, y0: 175.2 }, { text: "ยอดคงเหลือ", x0: 501.8, y0: 175.2 }],
  columns: [
    col("date", 15.0, 75.0),
    col("description", 75.0, 125.0),   // the code (BPKB, INP...)
    col("details", 125.0, 220.0),      // the reference
    col("amount", 270.0, 480.0),
    col("balance", 480.0, 590.0),
  ],
  amountSplitX: 400.0,
  signedBalances: true,
  yearsFourDigit: true,
  periodFromRows: true,
  remarkFields: ["description", "details"],
  legendRe: /\b([A-Z][A-Z#]{1,4}) - ([A-Z0-9/().#,-]+(?: [A-Z0-9/().#,-]+)*?)(?= [A-Z][A-Z#]{1,4} - |$)/g,
  patterns: [
    { re: new RegExp(`TOTAL DR (\\d+) ${MONEY} THB TOTAL CR (\\d+) ${MONEY}`), keys: ["withdraw_count", "withdraw_total", "deposit_count", "deposit_total"] },
  ],
  marks: {
    identify: ["อาคารเอ็กซิม", "0994000165927"],
    opening: ["ยอดยกมา"],
    closing: ["ยอดยกไป"],
    total_withdraw: [],
    total_deposit: [],
    period: [],
    account_no: ["เลขที่บัญชี"],
    account_name: [],
    branch: [],
    footer: ["ยอดยกไป", "PAGE DR", "TOTAL DR", "คำเตือน"],
    furniture_text: ["ยอดยกมา", "ยอดยกไป", "PAGE DR", "TOTAL DR"],
  },
});

// "ACCOUNT ACTIVITY HISTORY REPORT" - the bank does not print its own name
// (ask the team which bank). The other party's bank, account and name print on
// lines under each transaction. No brought-forward line: the printed totals
// confirm the opening worked back.
const ACT_HIST = profile({
  key: "acthist", bank: "Account Activity History Report (ไม่มีชื่อธนาคาร)",
  // Column headings measured on the real PDF: the photo reader lines a photo up by these.
  anchors: [{ text: "Description", x0: 138.8, y0: 105.4 }, { text: "Debit", x0: 295.8, y0: 105.4 }, { text: "Credit", x0: 352.3, y0: 105.4 }, { text: "Balance", x0: 414.2, y0: 105.4 }, { text: "Channel", x0: 463.0, y0: 105.4 }],
  columns: [
    col("date", 15.0, 57.0),
    col("value_date", 57.0, 93.0),
    col("description", 93.0, 218.0),
    col("channel", 218.0, 240.0),      // the transaction code
    col("details", 240.0, 290.0),      // cheque number
    col("amount", 290.0, 400.0),
    col("balance", 400.0, 460.0),
    col("channel", 460.0, 600.0),      // channel, terminal, branch
  ],
  amountSplitX: 345.0,
  openingPrinted: false,
  signedBalances: true,
  wrapStrip: ["Bank/Branch:", "Account Number:", "Account Name:", "Reference:"],
  remarkFields: ["description"],
  patterns: [
    { re: new RegExp(`Total Debit : ${MONEY}`), keys: ["withdraw_total"] },
    { re: new RegExp(`Total Credit : ${MONEY}`), keys: ["deposit_total"] },
  ],
  marks: {
    identify: ["ACCOUNT ACTIVITY HISTORY REPORT"],
    opening: [],
    closing: [],
    total_withdraw: [],
    total_deposit: [],
    period: ["From:"],
    account_no: ["Account"],
    account_name: [],
    branch: [],
    footer: ["Total Debit", "Total Credit", "Page"],
    furniture_text: ["ACCOUNT ACTIVITY", "Tran Date", "Total Debit", "Total Credit"],
  },
});

// The business forms come first: each is told by marks its personal cousin
// never prints, and K-BIZ carries the personal KBank's footer too.
// bblreport before bbl: the report's footer carries BBL's identifying name too.
export const PROFILES = { scbbiz: SCB_BIZ, kbiz: KBIZ, ttbbiz: TTB_BIZ, uobbiz: UOB_BIZ, exim: EXIM, acthist: ACT_HIST,
  kbank: KBANK, scb: SCB, ktb: KTB, uob: UOB, bblreport: BBL_REPORT, bbl: BBL, kkp: KKP, ktbcorp: KTB_CORP };


export function columnOf(p, x0, x1) {
  const c = (x0 + x1) / 2;
  for (const k of p.columns) if (k.lo <= c && c < k.hi) return k.name;
  return null;
}

// Which bank produced this statement, by its own header/footer fingerprints.
// A mark given as a list needs every one of its parts.
export function identify(text) {
  for (const p of Object.values(PROFILES))
    if (p.marks.identify.some(m => (Array.isArray(m) ? m.every(x => text.includes(x)) : text.includes(m)))) return p;
  return null;
}
