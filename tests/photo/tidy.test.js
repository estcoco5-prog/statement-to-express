import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinThai, repairMoney, tidyWords } from '../../src/photo/tidy.js';

const W = (text, x0, x1, y0 = 0, y1 = 20) => ({ text, x0, x1, y0, y1, conf: 90 });

test('Thai letters read one by one are joined back into words', () => {
  const out = joinThai([W('โ', 0, 8), W('อ', 9, 16), W('น', 17, 25), W('100.00', 80, 130)]);
  assert.deepEqual(out.map(w => w.text), ['โอน', '100.00']);
  assert.equal(out[0].x1, 25);
});

test('Thai words with a real gap between them stay apart', () => {
  assert.deepEqual(joinThai([W('ยอด', 0, 30), W('รวม', 60, 90)]).map(w => w.text), ['ยอด', 'รวม']);
});

test('money is rebuilt only when its shape is unambiguous', () => {
  assert.equal(repairMoney('1.234.56'), '1,234.56');
  assert.equal(repairMoney('5432109'), '54,321.09');
  assert.equal(repairMoney('1,234.56'), '1,234.56');
  assert.equal(repairMoney('12/06/26'), null);          // a date is never touched
  assert.equal(repairMoney('O1/40/25'), null);
  assert.equal(repairMoney('abc'), null);
});

test('dates are never corrected; money is repaired only in money columns', () => {
  const words = [W('01/40/25', 0, 50), W('5432109', 300, 350), W('5432109', 100, 150)];
  const out = tidyWords(words, w => w.x0 >= 300);
  const at = x => out.find(w => w.x0 === x).text;          // output is in page order
  assert.deepEqual([at(0), at(300), at(100)], ['01/40/25', '54,321.09', '5432109']);
});

test('a Thai word to the LEFT of the previous one is never glued onto it', () => {
  // Two headings on nearly the same line, the second one further left.
  const out = joinThai([W('ยอดคงเหลือ', 286, 316, 0, 20), W('ถอนเงิน', 213, 240, 4, 24)]);
  assert.deepEqual(out.map(w => w.text).sort(), ['ถอนเงิน', 'ยอดคงเหลือ'].sort());
});

import { cleanEdges, joinSplitMoney } from '../../src/photo/tidy.js';

test('Thai vowels and tone marks sitting over a letter join onto it', () => {
  // "วันที่" read as ว ั น ท ี ่ - the marks overlap the letter before them.
  const out = joinThai([W('ว', 0, 9), W('ั', 3, 8), W('น', 9, 18), W('ท', 19, 28), W('ี', 21, 27), W('่', 22, 26)]);
  assert.deepEqual(out.map(w => w.text), ['วันที่']);
});

test('table rule lines read as | ( ) are stripped from word edges only', () => {
  assert.deepEqual(cleanEdges([W('|17:30', 0, 30), W('(13:38', 40, 70), W('|', 80, 82), W('ENET', 90, 120)]).map(w => w.text),
    ['17:30', '13:38', 'ENET']);
  assert.equal(cleanEdges([W('CO.,LTD.', 0, 40)])[0].text, 'CO.,LTD.');
});

test('an amount split by a stray space is joined, in money columns only', () => {
  const words = [W('12,304', 300, 330), W('.86', 332, 345), W('12', 100, 110), W('.86', 112, 125)];
  const out = joinSplitMoney(words, w => w.x0 >= 300);
  assert.deepEqual(out.map(w => w.text).sort(), ['12,304.86', '12', '.86'].sort());   // page order
  assert.equal(out.find(w => w.text === '12,304.86').x1, 345);
});

test('letters of different heights on one line keep their left-to-right order (real boxes)', () => {
  // วันที่ as tesseract boxed it on a 200-dpi page: tall and short letters, tops 421-439.
  const B = (text, x0, x1, y0, y1) => ({ text, x0, x1, y0, y1, conf: 93 });
  const out = joinThai([B('ว', 1124, 1134, 421, 460), B('ั', 1133, 1142, 430, 452), B('น', 1141, 1149, 439, 452),
    B('ท', 1148, 1156, 421, 460), B('ี', 1157, 1166, 425, 452), B('่', 1165, 1176, 421, 460),
    B('01/07/2026', 1323, 1430, 438, 454)]);
  assert.deepEqual(out.map(w => w.text), ['วันที่', '01/07/2026']);
});

test('a table rule read inside a word splits it in two', () => {
  const out = cleanEdges([W('10,203.04|PrompiPay', 0, 190)]);
  assert.deepEqual(out.map(w => w.text), ['10,203.04', 'PrompiPay']);
  assert.ok(out[0].x1 <= out[1].x0 && out[0].x0 === 0 && out[1].x1 === 190);
});

import { repairDate } from '../../src/photo/tidy.js';

// Measured on BBL phone photos: "01/10/25" read as "01/1025" and "01710725";
// each lost row broke the balance chain for the rows after it. Repaired only
// to a real date in the date column's own shape - anything else stays as read.
test('a date with a slash lost or read as 7 is repaired, only to a real date', () => {
  assert.equal(repairDate('01710725'), '01/10/25');
  assert.equal(repairDate('01/1025'), '01/10/25');
  assert.equal(repairDate('1710/25'), null);                  // really 01/10/25: would rebuild WRONG as 17/10/25
  assert.equal(repairDate('0110/25'), null);                  // first slash lost: the day is not certain
  assert.equal(repairDate('011025'), null);
  assert.equal(repairDate('01110/2026'), '01/10/2026');
  assert.equal(repairDate('09-06-26'), '09-06-26');          // already a date: unchanged
  assert.equal(repairDate('01/10/25'), '01/10/25');
  assert.equal(repairDate('41713725'), null);                 // day 41, month 13: not a date
  assert.equal(repairDate('1,000.00'), null);
  assert.equal(repairDate('TRF'), null);
});
