// A made-up KBank page that passes every check as a PDF: the shared fixtures
// plus what the photo pipeline needs to recognise it - the KBank footer mark
// and the KBank column headings (anchors) where the real PDF prints them.
import { word, rightAligned } from '../helpers.js';
import { headerLines, openingLine, txLine, uobLine } from '../fixtures.js';
import { PROFILES } from '../../src/engine/profiles.js';

export function kbankPageWords() {
  return [
    ...headerLines(),
    ...PROFILES.kbank.anchors.map(a => word(a.text, a.x0, a.y0)),
    ...openingLine(193),
    ...txLine(205, { date: '09-06-26', desc: 'โอนเงิน', withdraw: '10,000.00', balance: '21,234.56' }),
    ...txLine(217, { date: '19-06-26', desc: 'ดอกเบี้ย', deposit: '65.43', balance: '21,299.99' }),
    word('KBPDF', 66.0, 800.0),
  ];
}

// Made-up UOB pages, as photos would carry them: page 1 the account summary
// (period, overview, no transaction table), page 2 the transactions.
export function uobSummaryWords() {
  const line = (y, ...items) => items.map(([text, x]) => word(text, x, y));
  return [
    ...line(60, ['Period:', 47.3], ['01', 81.9], ['Sep', 95.8], ['2026', 116.3], ['to', 141.4],
      ['30', 153.0], ['Sep', 166.9], ['2026', 187.4]),
    ...line(100, ['Account', 52.5], ['Overview', 90.0], ['as', 140.0], ['at', 152.0], ['30', 162.0],
      ['Sep', 175.0], ['2026', 192.0]),
    ...line(130, ['Deposits', 52.5], ['12,345.67', 480.0]),
    ...line(150, ['Savings', 52.5], ['THB', 150.0], ['0.00', 250.0], ['23.45', 330.0], ['12,345.67', 480.0]),
    ...line(170, ['Total', 52.5], ['(THB)', 80.0], ['12,345.67', 480.0]),
    ...line(200, ['Monthly', 52.5], ['Average', 95.0], ['Balance', 140.0], ['11,111.11', 480.0]),
    ...line(215, ['Bonus', 52.5], ['Interest', 85.0], ['earned', 125.0], ['3.33', 480.0]),
    ...line(230, ['Eligible', 52.5], ['Spend', 95.0], ['2,222.22', 480.0]),
    ...line(260, ['End', 250.0], ['of', 270.0], ['Summary', 282.0]),
  ];
}

export function uobStatementWords() {
  return [
    word('Account', 52.5, 80), word('Transaction', 97.1, 80), word('Details', 159.8, 80),
    ...PROFILES.uob.anchors.map(a => word(a.text, a.x0, a.y0)),
    ...uobLine(200, '01 Sep', 'BALANCE B/F', { balance: '20,000.00' }),
    ...uobLine(215, '02 Sep', 'PAY', { deposit: '500.00', balance: '20,500.00' }),
    ...uobLine(230, '03 Sep', 'PAY', { deposit: '1,250.00', balance: '21,750.00' }),
    ...uobLine(245, '04 Sep', 'FEE', { withdraw: '10.00', balance: '21,740.00' }),
    ...uobLine(260, '05 Sep', 'PAY', { deposit: '60.00', balance: '21,800.00' }),
    word('Total', 105.5, 290), rightAligned('10.00', 380.4, 290), rightAligned('1,810.00', 457.2, 290),
    rightAligned('21,800.00', 545.7, 290),
  ];
}
