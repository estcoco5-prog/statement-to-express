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
    th: 'PDF นี้เป็นรูปภาพล้วน ไม่มีตัวอักษรให้อ่าน โปรดขอไฟล์ PDF ของธนาคารจากลูกค้า',
    en: "This PDF is pictures only, with no text to read. Ask the client for the bank's own PDF.",
  },
  'unknown-bank': {
    th: 'อ่านรูปแบบใบแจ้งยอดนี้ไม่ได้ ยังไม่รู้จักธนาคารนี้ และตารางไม่ใช่แบบง่าย',
    en: "This statement's layout could not be read: the bank is not known yet and its table is not a simple one.",
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
  red: { icon: '🔴', en: 'A check failed - Review file only, no Express file for that month',
    th: 'มีการตรวจที่ไม่ผ่าน - เดือนนั้นมีเฉพาะไฟล์ตรวจสอบ ไม่มีไฟล์ Express' },
  blocked: { icon: '⛔', en: 'Nothing could be read', th: 'อ่านไฟล์ไม่ได้' },
};

export const UNTESTED_TEXT = {
  en: 'This bank has not been tested yet. Amounts are proved by the balance; check dates and descriptions by eye.',
  th: 'ธนาคารนี้ยังไม่ได้ทดสอบ ยอดเงินตรวจด้วยยอดคงเหลือแล้ว โปรดตรวจวันที่และรายละเอียดด้วยตา',
};

const RANK = { green: 0, yellow: 1, red: 2 };
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
