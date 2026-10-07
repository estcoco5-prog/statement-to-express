// The per-bank reading rules - a value-for-value copy of the private answer
// key's bank_profiles.py (generated from it, so no Thai label was retyped).
// Every column bound is in PDF points from the left page edge, measured on a
// real statement of that bank; see bank_profiles.py for each measurement.
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
           openingPrinted: true, remarkFields: null, untested: false, wrapReach: null, codeNames: {}, ...p, marks };
}

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

export const PROFILES = { kbank: KBANK, scb: SCB, ktb: KTB, uob: UOB, bbl: BBL, kkp: KKP, ktbcorp: KTB_CORP };


export function columnOf(p, x0, x1) {
  const c = (x0 + x1) / 2;
  for (const k of p.columns) if (k.lo <= c && c < k.hi) return k.name;
  return null;
}

// Which bank produced this statement, by its own header/footer fingerprints.
export function identify(text) {
  for (const p of Object.values(PROFILES))
    if (p.marks.identify.some(m => text.includes(m))) return p;
  return null;
}
