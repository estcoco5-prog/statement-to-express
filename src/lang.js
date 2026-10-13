// The page's language: Thai (the team's) or English, chosen on the page and
// remembered in this browser only. Nothing here changes a check: the engine
// keeps writing its notes in English (its own logic reads some of them), and
// thai() turns them into Thai only where they are shown.

import { MESSAGES } from './view.js';

const KEY = 'statement-to-express-lang';

function stored() {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'th'; } catch { return 'th'; }
}

let current = stored();
const listeners = new Set();

export const lang = () => current;
export const onLang = fn => listeners.add(fn);

export function setLang(next) {
  current = next === 'en' ? 'en' : 'th';
  try { localStorage.setItem(KEY, current); } catch { /* private window: this visit only */ }
  for (const fn of listeners) fn(current);
}

// A text in both languages. The Thai may be left out for an engine note: it
// is then worked out by thai() when shown.
export const pair = (en, th) => ({ en: String(en ?? ''), th: th === undefined ? thai(en) : String(th) });
export const isPair = x => x !== null && typeof x === 'object' && 'en' in x && 'th' in x;
export const pick = x => (isPair(x) ? x[current] : String(x ?? ''));

// ---- engine notes -> Thai ------------------------------------------------------
// Words inside a note first (where a line is), then the whole sentence. A
// sentence no rule knows stays in English - tests/lang.test.js runs the
// engine's notes through here so a new one cannot slip by unnoticed.

const PLACE = { picture: 'รูปที่', page: 'หน้า', file: 'ไฟล์' };
const DIRECTION = { withdrawal: 'ถอน', deposit: 'ฝาก', withdrawals: 'ถอน', deposits: 'ฝาก' };
const places = text => text
  .replace(/\b(picture|page|file) (\d+) (?:line|row) (\d+)/g, (_, p, n, l) => `${PLACE[p]} ${n} บรรทัด ${l}`)
  .replace(/\b(picture|page|file)s? (\d+(?:, \d+)*(?: -> \d+)?)/g, (_, p, n) => `${PLACE[p]} ${n}`);

const CHECK = 'ตรวจกับต้นฉบับ';
const RULES = [
  // the lights on each line (picture/lights.js)
  [/^proved by the balance$/, 'ยอดคงเหลือยืนยันแล้ว'],
  [/^the balance does not add up$/, 'ยอดคงเหลือไม่ลงตัว'],
  [/^รูปที่ (\d+) does not carry on from the picture before it, or repeats its rows - check the order of the pictures$/,
    'รูปที่ $1 ไม่ต่อจากรูปก่อนหน้า หรือซ้ำกับรายการที่มีแล้ว - ตรวจลำดับรูป'],
  [/^adds up - type the opening or closing balance from the paper to confirm it$/,
    'ยอดลงตัว - พิมพ์ยอดยกมาหรือยอดคงเหลือปลายงวดจากเอกสารเพื่อยืนยัน'],
  [/^adds up, but a balance typed in does not match what was read$/, 'ยอดลงตัว แต่ยอดที่พิมพ์ไว้ไม่ตรงกับที่อ่านได้'],
  [/^the line before it does not add up, so the balance it starts from is not confirmed$/,
    'บรรทัดก่อนหน้าไม่ลงตัว จึงยังยืนยันยอดตั้งต้นของบรรทัดนี้ไม่ได้'],
  [/^the line after it does not add up, so its balance is not confirmed$/,
    'บรรทัดถัดไปไม่ลงตัว จึงยังยืนยันยอดคงเหลือของบรรทัดนี้ไม่ได้'],
  [/^nothing comes after it to confirm its balance - type the closing balance$/,
    'ไม่มีบรรทัดถัดไปยืนยันยอดคงเหลือ - พิมพ์ยอดคงเหลือปลายงวด'],
  [/^nothing before it confirms it - type the opening balance$/, 'ไม่มีบรรทัดก่อนหน้ายืนยัน - พิมพ์ยอดยกมา'],
  [/^not joined to a balance typed in by an unbroken run of proved lines$/,
    'ยังไม่เชื่อมกับยอดที่พิมพ์ไว้ด้วยบรรทัดที่ตรวจผ่านต่อเนื่องกัน'],
  [/^this may be \+(\S+) with the "\+" read as a 4 - the balance agrees with (\S+)$/,
    'อาจเป็น +$1 โดยอ่านเครื่องหมาย "+" เป็นเลข 4 - ยอดคงเหลือตรงกับ $2'],
  [/^the balance changed by (\S+) - that may be the amount, if the balance above was read right$/,
    'ยอดคงเหลือเปลี่ยนไป $1 - อาจเป็นจำนวนเงินของบรรทัดนี้ ถ้าอ่านยอดคงเหลือบรรทัดบนถูก'],
  [/^check the paper$/, 'ตรวจกับเอกสาร'],
  [/^type it from the paper$/, 'พิมพ์จากเอกสาร'],
  [/^the reader was unsure of the date \(reads (.+)\) - check the date$/, 'ไม่แน่ใจวันที่ที่อ่านได้ (อ่านได้ $1) - ตรวจวันที่'],
  [/^the date could not be read: filled in as (.+), the date the lines either side both read - check it against the paper$/,
    'อ่านวันที่ไม่ได้: ใส่เป็น $1 ตามบรรทัดบนและล่างที่อ่านได้วันเดียวกัน - ตรวจกับเอกสาร'],
  [/^the lines either side both read (.+) - it may be (.+)$/, 'บรรทัดบนและล่างอ่านได้ $1 ทั้งคู่ - วันที่นี้อาจเป็น $2'],
  // the set (picture/lights.js)
  [/^No table was read from these pictures\.?$/, 'ไม่มีตารางที่อ่านได้จากรูปชุดนี้'],
  [/^No transaction lines were found$/, 'ไม่พบบรรทัดรายการ'],
  [/^(\d+) picture\(s\) could not be read$/, 'อ่านไม่ได้ $1 รูป'],
  [/^A balance typed in does not match what was read$/, 'ยอดที่พิมพ์ไว้ไม่ตรงกับที่อ่านได้'],
  [/^(\d+) lines? with something wrong$/, '$1 บรรทัดมีจุดผิด'],
  [/^(\d+) lines? to look at$/, '$1 บรรทัดต้องตรวจดู'],
  [/^Every line is proved by the balance - still check it against the paper$/,
    'ทุกบรรทัดตรวจกับยอดคงเหลือผ่าน - แต่ยังควรเทียบกับเอกสารอีกครั้ง'],
  [/^Picture (\d+) read$/, 'อ่านรูปที่ $1 ได้'],
  [/^no table was read$/, 'อ่านตารางไม่ได้'],
  [/^no column of amounts was found in this picture$/, 'ไม่พบคอลัมน์จำนวนเงินในรูปนี้'],
  [/^fewer than 2 lines with amounts were found$/, 'พบบรรทัดที่มีจำนวนเงินไม่ถึง 2 บรรทัด'],
  [/^nothing was read on this page - check it is a printed passbook page, flat and whole$/,
    'อ่านอะไรในหน้านี้ไม่ได้ - ตรวจว่าเป็นหน้าสมุดบัญชีที่พิมพ์รายการ วางราบ และเห็นทั้งหน้า'],
  // lines that are not transactions (table/columns.js)
  [/^above the heading row$/, 'อยู่เหนือแถวหัวตาราง'],
  [/^a totals row$/, 'แถวยอดรวม'],
  [/^text only$/, 'มีแต่ข้อความ'],
  [/^used as the opening balance$/, 'ใช้เป็นยอดยกมา'],
  [/^a brought-forward line$/, 'บรรทัดยอดยกมา'],
  // a line's notes (engine/lines.js, table/columns.js, table/statement.js)
  [/^nothing on this line could be read \((.+)\) - type it from the original$/, `อ่านบรรทัดนี้ไม่ได้เลย ($1) - พิมพ์จากต้นฉบับ`],
  [/^the amount could not be read \((.+)\) - type it from the original$/, 'อ่านจำนวนเงินไม่ได้ ($1) - พิมพ์จากต้นฉบับ'],
  [/^the balance could not be read \((.+)\) - check it against the original$/, `อ่านยอดคงเหลือไม่ได้ ($1) - ${CHECK}`],
  [/^the same day, amount and balance as (.+) - a repeated picture\? check it$/,
    'วันที่ จำนวนเงิน และยอดคงเหลือ เหมือนกับ$1 - รูปซ้ำหรือไม่? ตรวจดู'],
  [/^the first line has nothing before it to be checked against - check it against the original$/,
    `บรรทัดแรกไม่มีบรรทัดก่อนหน้าให้ตรวจเทียบ - ${CHECK}`],
  [/^shown as a (withdrawal|deposit) but the balance says (withdrawal|deposit) - check this line$/,
    (_, a, b) => `แสดงเป็นรายการ${DIRECTION[a]} แต่ยอดคงเหลือบอกว่าเป็นรายการ${DIRECTION[b]} - ตรวจบรรทัดนี้`],
  [/^the date could not be read - check it against the original$/, `อ่านวันที่ไม่ได้ - ${CHECK}`],
  [/^the date reads (\S+), earlier than (.+) above \((\S+)\) - check the date$/,
    'วันที่อ่านได้ $1 ซึ่งก่อนวันที่ของ$2 ข้างบน ($3) - ตรวจวันที่'],
  [/^its date \((\S+)\) may be read too late: (.+) below reads earlier \((\S+)\) - check both dates$/,
    'วันที่ของบรรทัดนี้ ($1) อาจอ่านเป็นวันที่ช้าเกินไป: $2 ข้างล่างอ่านได้วันที่ก่อนหน้า ($3) - ตรวจทั้งสองวันที่'],
  [/^more than one amount on this line \((.+)\) - check it$/, 'มีจำนวนเงินมากกว่าหนึ่งช่องในบรรทัดนี้ ($1) - ตรวจดู'],
  [/^"(.*)" could not be read as an amount \((.+)\)$/, 'อ่าน "$1" เป็นจำนวนเงินไม่ได้ ($2)'],
  [/^"(.*)" could not be read as a balance \((.+)\)$/, 'อ่าน "$1" เป็นยอดคงเหลือไม่ได้ ($2)'],
  [/^the date reads (\S+), an unlikely year - check the date$/, 'วันที่อ่านได้ $1 ปีดูไม่น่าใช่ - ตรวจวันที่'],
  [/^"(.*)" is not a real date$/, '"$1" ไม่ใช่วันที่ที่มีจริง'],
  [/^"(.*)" only makes sense month-first - check the date$/, '"$1" อ่านได้เฉพาะแบบเดือนขึ้นก่อนวัน - ตรวจวันที่'],
  [/^"(.*)" has no year, or is not a real date - check the date$/, '"$1" ไม่มีปี หรือไม่ใช่วันที่ที่มีจริง - ตรวจวันที่'],
  [/^"(.*)" could not be read as a date$/, 'อ่าน "$1" เป็นวันที่ไม่ได้'],
  [/^(?:the date number (\S+ \(\S+\))|(".*")) could be day-first or month-first, and the dates in this file do not prove which \((.+)\) - check the date$/,
    (_, number, quoted, where) => `วันที่ ${number ?? quoted} อ่านได้ทั้งแบบวันขึ้นก่อนและเดือนขึ้นก่อน และวันที่อื่นในไฟล์ยืนยันไม่ได้ว่าเป็นแบบไหน (${where}) - ตรวจวันที่`],
  [/^the dates in this file do not agree on which way round they are written, so this one may be misread too \((.+)\) - check the date$/,
    'วันที่ในไฟล์นี้เขียนวัน/เดือนสลับกันไม่เหมือนกัน วันที่นี้จึงอาจอ่านผิดด้วย ($1) - ตรวจวันที่'],
  // the balance chain (engine/verify.js)
  [/^the balance did not change, so whether (\S+) went in or out cannot be determined - check this row by hand$/,
    'ยอดคงเหลือไม่เปลี่ยน จึงบอกไม่ได้ว่า $1 เป็นเงินเข้าหรือเงินออก - ตรวจรายการนี้เอง'],
  [/^balance chain broken: (\S+) -> (\S+) is a change of (\S+), but the amount printed is (\S+)(?: \(tax (\S+)\))?$/,
    (_, a, b, c, d, t) => `ยอดคงเหลือไม่ต่อเนื่อง: ${a} -> ${b} เปลี่ยนไป ${c} แต่จำนวนเงินในรายการคือ ${d}${t ? ` (ภาษี ${t})` : ''}`],
  [/^the balance says this is a (withdrawal|deposit), but it is printed in the (withdrawal|deposit) column - the balance was believed$/,
    (_, a, b) => `ยอดคงเหลือบอกว่าเป็นรายการ${DIRECTION[a]} แต่พิมพ์อยู่ในคอลัมน์${DIRECTION[b]} - ยึดตามยอดคงเหลือ`],
  [/^no balance was printed after this row, so it could not be checked against one$/,
    'ไม่มียอดคงเหลือพิมพ์หลังรายการนี้ จึงตรวจเทียบไม่ได้'],
  [/^these (\d+) rows share one printed balance, and they do not add up to it: (\S+) -> (\S+) is a change of (\S+), the rows net (.+)$/,
    '$1 รายการนี้ใช้ยอดคงเหลือที่พิมพ์ไว้ยอดเดียวกัน และรวมกันไม่เท่ายอดนั้น: $2 -> $3 เปลี่ยนไป $4 แต่รายการรวมกันได้ $5'],
  // the checks (engine/verify.js, engine/lines.js)
  [/^Every row agrees with the running balance$/, 'ทุกรายการตรงกับยอดคงเหลือ'],
  [/^(\d+) of (\d+) rows verified$/, 'ตรวจผ่าน $1 จาก $2 รายการ'],
  [/^(\d+) could not be$/, 'ตรวจไม่ผ่าน $1 รายการ'],
  [/^Dates never go backwards$/, 'วันที่ไม่ย้อนหลัง'],
  [/^in order$/, 'เรียงตามลำดับ'],
  [/^(\S+) comes after (\S+)$/, '$1 อยู่ถัดจาก $2 (วันที่ย้อนหลัง)'],
  [/^Final balance matches the closing balance the bank printed$/, 'ยอดคงเหลือสุดท้ายตรงกับยอดคงเหลือปลายงวดที่ธนาคารพิมพ์'],
  [/^computed (.+) vs printed (\S+)$/, 'คำนวณได้ $1 เทียบกับที่พิมพ์ $2'],
  [/^Total (withdrawals|deposits) matches the bank's own total$/, (_, d) => `ยอดรวมรายการ${DIRECTION[d]}ตรงกับยอดรวมของธนาคาร`],
  [/^Number of (withdrawals|deposits) matches the bank's own count$/, (_, d) => `จำนวนรายการ${DIRECTION[d]}ตรงกับจำนวนของธนาคาร`],
  [/^found (\d+) vs printed (\d+)$/, 'พบ $1 เทียบกับที่พิมพ์ $2'],
  [/^Tax the bank withheld, written as its own withdrawal rows$/, 'ภาษีที่ธนาคารหักไว้ แยกเป็นรายการถอนของตัวเอง'],
  [/^(\d+) row\(s\), total (.+)$/, '$1 รายการ รวม $2'],
  [/^Opening balance \(not printed by the bank\) worked back from row 1$/, 'ยอดยกมา (ธนาคารไม่ได้พิมพ์) คำนวณย้อนจากรายการแรก'],
  [/^confirmed only through the totals checks above$/, 'ยืนยันได้ผ่านการตรวจยอดรวมข้างบนเท่านั้น'],
  [/^Rows dated outside the statement period \(allowed, listed\)$/, 'รายการที่ลงวันที่นอกงวดใบแจ้งยอด (ใช้ได้ แสดงไว้ให้ทราบ)'],
  [/^No other anomalies on any row$/, 'ไม่มีความผิดปกติอื่นในรายการใด'],
  [/^(\d+) row\(s\) carry a warning$/, '$1 รายการมีคำเตือน'],
  [/^clean$/, 'ไม่มี'],
  [/^Last line confirmed by a later line$/, 'บรรทัดสุดท้ายมีบรรทัดถัดไปยืนยัน'],
  [/^Each page carries on from the one before$/, 'ทุกหน้าต่อจากหน้าก่อนหน้า'],
  [/^No rows repeated from an earlier (?:file|picture|page)$/, 'ไม่มีรายการซ้ำกับหน้าก่อนหน้า'],
  [/^Every line linked to a balance typed in$/, 'ทุกบรรทัดเชื่อมกับยอดที่พิมพ์ไว้'],
  [/^First line confirmed by the opening balance typed in$/, 'บรรทัดแรกยืนยันด้วยยอดยกมาที่พิมพ์ไว้'],
  [/^the chain breaks where these meet - one missing, out of order, or a misread line: (.+)$/,
    'ยอดคงเหลือขาดช่วงตรงรอยต่อนี้ - อาจขาดหน้า สลับลำดับ หรืออ่านบรรทัดผิด: $1'],
  [/^every (?:file|picture|page) follows on$/, 'ทุกหน้าต่อเนื่องกัน'],
  [/^(.+) repeats? rows of an earlier (?:file|picture|page) \(overlapping pictures\?\) - nothing from (?:it|them) is sent$/,
    '$1 ซ้ำกับรายการของหน้าก่อนหน้า (รูปซ้อนกันหรือไม่?) - ไม่ส่งรายการจากส่วนนั้นเลย'],
  [/^no (?:file|picture|page) repeats another$/, 'ไม่มีหน้าใดซ้ำกัน'],
  [/^an opening of 0\.00 cannot show which way the lines go \(an overdrawn account read without its minus signs also starts at 0\), so every line is listed to check by hand - type the closing balance too if it is not 0$/,
    'ยอดยกมา 0.00 บอกทิศทางเงินเข้า-ออกไม่ได้ (บัญชีติดลบที่อ่านไม่เห็นเครื่องหมายลบก็เริ่มที่ 0 เหมือนกัน) จึงต้องตรวจทุกบรรทัดเอง - ถ้ายอดคงเหลือปลายงวดไม่ใช่ 0 ให้พิมพ์ด้วย'],
  [/^no brought-forward line was read, so the (\S+) typed in is the opening$/, 'ไม่พบบรรทัดยอดยกมา จึงใช้ $1 ที่พิมพ์ไว้เป็นยอดยกมา'],
  [/^typed (\S+), worked back from the first line (\S+)$/, 'พิมพ์ไว้ $1, คำนวณย้อนจากบรรทัดแรกได้ $2'],
  [/^typed (\S+), read (\S+)$/, 'พิมพ์ไว้ $1, อ่านได้ $2'],
  [/^no opening balance typed in, so the first line is listed to check by hand$/, 'ไม่ได้พิมพ์ยอดยกมา จึงต้องตรวจบรรทัดแรกเอง'],
  [/^nothing comes after (.+) \(balance not read\), so it is listed to check by hand$/,
    'ไม่มีบรรทัดถัดจาก$1 (อ่านยอดคงเหลือไม่ได้) จึงต้องตรวจเอง'],
  [/^nothing comes after (.+) \(balance (\S+)\), so it is listed to check by hand$/,
    'ไม่มีบรรทัดถัดจาก$1 (ยอดคงเหลือ $2) จึงต้องตรวจเอง'],
  [/^no lines$/, 'ไม่มีบรรทัด'],
  [/^(\d+) line\(s\) not linked to the opening or closing balance typed in by an unbroken run of proved lines$/,
    '$1 บรรทัดยังไม่เชื่อมกับยอดยกมาหรือยอดคงเหลือปลายงวดที่พิมพ์ไว้ ด้วยบรรทัดที่ตรวจผ่านต่อเนื่องกัน'],
  [/^every line is linked to a balance typed in$/, 'ทุกบรรทัดเชื่อมกับยอดที่พิมพ์ไว้'],
  // several statements of one account (engine/batch.js, engine/output/express.js)
  [/^failed its own checks$/, 'ไม่ผ่านการตรวจของตัวเอง'],
  [/^same days as (.+) - left out so nothing is imported twice$/, 'ช่วงวันเดียวกับ $1 - ตัดออกเพื่อไม่ให้นำเข้าซ้ำ'],
  [/^Only one statement for this account$/, 'บัญชีนี้มีใบแจ้งยอดใบเดียว'],
  [/^nothing to link$/, 'ไม่มีเดือนให้เชื่อมต่อ'],
  [/^Every statement's period could be read$/, 'อ่านงวดของใบแจ้งยอดได้ทุกใบ'],
  [/^(\S+) to (\S+) appears in both (.+)$/, (_, a, b, names) => `${a} ถึง ${b} อยู่ทั้งใน ${names.replace(/ and /g, ' และ ')}`],
  [/^periods overlap: (.+)$/, 'งวดซ้อนกัน: $1'],
  [/^gap: nothing covers (\S+) to (\S+)$/, 'ขาดช่วง: ไม่มีใบแจ้งยอดครอบคลุม $1 ถึง $2'],
  [/^(\S+) closes at (\S+) but (\S+) opens at (\S+) \((.+)\)$/, '$1 ยอดคงเหลือปลายงวด $2 แต่ $3 ยอดยกมา $4 ($5)'],
  [/^No statement appears twice$/, 'ไม่มีใบแจ้งยอดซ้ำ'],
  [/^No month is missing$/, 'ไม่มีเดือนที่ขาด'],
  [/^Each closing balance is the next opening balance$/, 'ยอดคงเหลือปลายงวดของแต่ละใบเท่ากับยอดยกมาของใบถัดไป'],
  [/^(\d+) of (\d+) links agree$/, 'ตรงกัน $1 จาก $2 จุด'],
  [/^none$/, 'ไม่มี'],
  [/^no rows$/, 'ไม่มีรายการ'],
  [/^nothing to import - (.+)$/, (_, rest) => `ไม่มีรายการให้นำเข้า - ${rest.split('; ').map(thaiClause).join('; ')}`],
  [/^Spreadsheet from a picture \(Excel → Express\)$/, 'ตารางที่อ่านจากรูป'],
  // why a file could not be read (shown under the Thai message)
  [/^this file is locked$/, 'ไฟล์นี้ล็อกด้วยรหัสผ่าน'],
  [/^the password is not right$/, 'รหัสผ่านไม่ถูกต้อง'],
  [/^this is not a PDF that can be opened$/, 'ไฟล์นี้ไม่ใช่ PDF ที่เปิดได้'],
  [/^no text found - this PDF is pictures only$/, 'ไม่พบตัวอักษร - PDF นี้มีแต่รูปภาพ'],
  [/^this statement does not match any bank profile yet$/, 'ใบแจ้งยอดนี้ยังไม่ตรงกับรูปแบบธนาคารใดในระบบ'],
  [/^an unexpected problem stopped this file being read$/, 'เกิดปัญหาที่ไม่คาดคิด จึงอ่านไฟล์นี้ไม่ได้'],
  [/^the statement period prints a 2-digit year \((\d+)\) that cannot be read safely as Western or Buddhist - refusing to guess$/,
    'งวดใบแจ้งยอดพิมพ์ปีเป็นเลข 2 หลัก ($1) ซึ่งบอกไม่ได้แน่ชัดว่าเป็น ค.ศ. หรือ พ.ศ. - จึงไม่เดา'],
  [/^the statement period could not be read, so Buddhist and Western years cannot be told apart safely - refusing to guess$/,
    'อ่านงวดใบแจ้งยอดไม่ได้ จึงแยก พ.ศ. กับ ค.ศ. ได้ไม่แน่ชัด - จึงไม่เดา'],
  [/^the statement period could not be read, and this bank prints no year on its rows - refusing to guess$/,
    'อ่านงวดใบแจ้งยอดไม่ได้ และธนาคารนี้ไม่พิมพ์ปีในรายการ - จึงไม่เดา'],
  [/^two dates landed on one line \((.+)\) - the row tolerance of (\S+) is too generous for this statement$/,
    'มีวันที่สองค่าอยู่ในบรรทัดเดียว ($1) - ระยะจัดบรรทัด $2 กว้างเกินไปสำหรับใบแจ้งยอดนี้'],
  [/^the opening balance row \((.+)\) was not found - without it the balance chain has no starting point$/,
    'ไม่พบบรรทัดยอดยกมา ($1) - ถ้าไม่มี ก็ไม่มีจุดเริ่มต้นตรวจยอดคงเหลือ'],
  [/^the (opening|closing) balance "(.*)" could not be read$/,
    (_, w, t) => `อ่าน${w === 'opening' ? 'ยอดยกมา' : 'ยอดคงเหลือปลายงวด'} "${t}" ไม่ได้`],
  [/^\(account number not read\)$/, '(อ่านเลขที่บัญชีไม่ได้)'],
  [/^\(period not read\)$/, '(อ่านงวดไม่ได้)'],
  [/^this file is not a photo that can be opened$/, 'ไฟล์นี้ไม่ใช่รูปที่เปิดได้'],
  [/^HEIC photo$/, 'รูปแบบ HEIC'],
];

// A text that already carries both languages ("English · ไทย" or "English / ไทย"): its Thai half.
const THAI = /[฀-๿]/;
function ownThai(text) {
  for (const sep of [' · ', ' / ']) {
    const i = text.lastIndexOf(sep);
    if (i > 0 && THAI.test(text.slice(i)) && !THAI.test(text.slice(0, i))) return text.slice(i + sep.length);
  }
  return null;
}

function thaiClause(clause) {
  const text = places(clause.trim());
  for (const [re, to] of RULES) if (re.test(text)) return text.replace(re, to);
  const message = Object.values(MESSAGES).find(m => m.en === clause.trim());
  if (message) return message.th;
  const own = ownThai(clause);
  if (own) return own;
  // "<note> (picture 1 line 3)": a note with where it is said on the end.
  const at = /^(.+) (\((?:รูปที่|หน้า|ไฟล์) [^()]+\))$/.exec(text);
  if (at) {
    const note = thaiClause(at[1]);
    if (note !== at[1]) return `${note} ${at[2]}`;
  }
  // "<file name>: <reason>" (a picture that could not be read): the reason only.
  const colon = text.indexOf(': ');
  if (colon > 0) {
    const tail = thaiClause(text.slice(colon + 2));
    if (tail !== text.slice(colon + 2)) return `${text.slice(0, colon)}: ${tail}`;
  }
  return clause;      // not known: shown as it was written
}

export function thai(text) {
  const s = String(text ?? '');
  if (!s) return s;
  const own = ownThai(s);
  if (own) return own;
  return s.split('; ').map(thaiClause).join('; ');
}


// A text written "English · ไทย" (older parts of the page): as a pair.
export function both(text) {
  const s = String(text ?? '');
  const i = s.lastIndexOf(' · ');
  if (i > 0 && THAI.test(s.slice(i)) && !THAI.test(s.slice(0, i))) return { en: s.slice(0, i), th: s.slice(i + 3) };
  return pair(s);
}
