// Synthetic statement builders, ported from the answer key's test suite.
// Positions are the ones measured on real statements; every identifier is
// MADE UP and balances are shifted by 20,000.00 from the private originals,
// so nothing here comes from a real person's account.
import { word, rightAligned } from './helpers.js';

// One KBank transaction line.
export function txLine(y, { date, time, desc, withdraw, deposit, balance, channel, details } = {}) {
  const words = [];
  if (date) words.push(word(date, 67.9, y, 24.2));
  if (time) words.push(word(time, 101.2, y, 14.6));
  if (desc) words.push(word(desc, 123.0, y));
  if (withdraw) words.push(rightAligned(withdraw, 252.0, y));   // withdrawal column
  if (deposit) words.push(rightAligned(deposit, 267.0, y));     // deposit column
  if (balance) words.push(rightAligned(balance, 329.0, y));
  if (channel) words.push(word(channel, 333.0, y));
  if (details) words.push(word(details, 404.0, y));
  return words;
}

// The block of facts KBank prints at the top of the page.
export function headerLines({ periodFrom = '01/06/2026', periodTo = '30/06/2026',
  closing = '21,299.99', wTotal = '10,000.00', wCount = 1, dTotal = '65.43', dCount = 1 } = {}) {
  return [
    word('ยอดยกไป', 345.0, 123.0), rightAligned(closing, 533.0, 123.0),
    word('รวมถอนเงิน', 345.0, 136.0), word(String(wCount), 377.3, 136.0),
    word('รายการ', 383.0, 136.0), rightAligned(wTotal, 533.0, 136.0),
    word('รวมฝากเงิน', 345.0, 149.0), word(String(dCount), 376.5, 149.0),
    word('รายการ', 382.2, 149.0), rightAligned(dTotal, 533.0, 149.0),
    word('รอบระหว่างวันที่', 345.0, 97.0), word(periodFrom, 393.0, 97.0),
    word('-', 424.6, 97.0), word(periodTo, 429.5, 97.0),
    word('เลขที่บัญชีเงินฝาก', 345.0, 84.0), word('123-4-56789-0', 393.0, 84.0),
  ];
}

// The block a new KBank page opens with: every line lacks a date and a balance.
export function pageHeaderBlock(periodFrom = '01/06/2026', periodTo = '30/06/2026') {
  return [
    word('หน้าที่', 472.3, 55.8), word('(PAGE/OF)', 489.6, 55.8), word('2/13', 521.7, 55.8),
    word('ที่', 66.0, 64.8), word('DD.000', 72.5, 64.8),
    word('N00000000000000000000I/2569', 98.8, 64.8),
    word('ชื่อบัญชี', 66.0, 78.0), word('นาย', 90.0, 78.0),
    word('เลขที่อ้างอิง', 345.0, 78.0), word('11111111111111111111', 393.0, 78.0),
    word('เลขที่บัญชีเงินฝาก', 345.0, 89.0), word('987-6-54321-0', 393.0, 89.0),
    word('รอบระหว่างวันที่', 345.0, 102.5), word(periodFrom, 393.0, 102.5),
    word('-', 424.6, 102.5), word(periodTo, 429.5, 102.5),
    word('สาขาเจ้าของบัญชี', 345.0, 115.5), word('สาขาทดสอบ', 393.0, 115.5),
    word('2/13(0000)', 246.0, 131.8),
    word('เวลา/', 101.5, 174.7), word('ยอดคงเหลือ', 285.9, 174.7),
    word('วันที่', 74.5, 180.5), word('รายการ', 152.6, 180.5),
    word('ถอนเงิน', 213.3, 180.5), word('ฝากเงิน', 239.7, 180.5),
    word('ช่องทาง', 357.6, 180.5), word('รายละเอียด', 454.9, 180.5),
    word('วันที่มีผล', 96.9, 186.3), word('(บาท)', 294.9, 186.3),
  ];
}

export function openingLine(y, balance = '31,234.56', date = '01-06-26') {
  return [word(date, 67.9, y, 24.2), word('ยอดยกมา', 123.0, y), rightAligned(balance, 329.0, y)];
}

export function uobLine(y, date, desc, { withdraw, deposit, balance } = {}) {
  const words = [];
  if (date) {
    const [day, mon] = date.split(' ');
    words.push(word(day, 52.5, y, 8.9), word(mon, 63.6, y, 14.2),
      word(day, 105.5, y, 8.9), word(mon, 116.7, y, 14.2));
  }
  if (desc) words.push(word(desc, 149.2, y));
  if (withdraw) words.push(rightAligned(withdraw, 380.4, y));
  if (deposit) words.push(rightAligned(deposit, 457.2, y));
  if (balance) words.push(rightAligned(balance, 545.7, y));
  return words;
}

export function uobPage(lines) {
  const head = [word('Period:', 47.3, 60), word('01', 81.9, 60), word('Sep', 95.8, 60),
    word('2026', 116.3, 60), word('to', 141.4, 60), word('30', 153.0, 60),
    word('Sep', 166.9, 60), word('2026', 187.4, 60),
    word('Account', 52.5, 80), word('Transaction', 97.1, 80), word('Details', 159.8, 80)];
  return head.concat(...lines);
}

export function ktbLine(y, date, desc, details, { withdraw, deposit, balance, time } = {}) {
  const words = [];
  if (date) words.push(word(date, 39.7, y, 31.0));
  if (desc) words.push(word(desc, 82.2, y));
  if (details) words.push(word(details, 209.8, y));
  if (withdraw) words.push(rightAligned(withdraw, 377.0, y));
  if (deposit) words.push(rightAligned(deposit, 439.4, y));
  if (balance) words.push(rightAligned(balance, 515.9, y), word('690', 544.5, y, 11.1));
  if (time) words.push(word(time, 39.7, y + 11.4, 16.1));
  return words;
}

export function ktbPage(body, periodFrom = '01/10/68', periodTo = '31/10/69') {
  const head = [word('รายการบัญชีระหว่างวันที่', 396.9, 55), word(periodFrom, 473.4, 55, 31.0),
    word('ถึง', 506.6, 55, 7.5), word(periodTo, 516.4, 55, 31.0)];
  return head.concat(...body);
}
