// The tables read from statement pictures -> one Excel file, the way a person
// would type it up: one sheet with every picture's lines in order (a first
// column says which picture each line came from), and a second sheet with the
// rest of the writing on each picture (bank name, account, period, footer).
// Cells are text exactly as read: nothing is changed, rounded or guessed.
import { Sheet, Cell, HEADER, BAD, BOLD, writeXlsx, LIGHT_GREEN, LIGHT_YELLOW, LIGHT_RED } from '../engine/output/xlsx.js';
import { thai } from '../lang.js';

const FILL = { green: LIGHT_GREEN, yellow: LIGHT_YELLOW, red: LIGHT_RED };
// eslint-disable-next-line no-control-regex
const clean = v => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
const WORDS = { green: ['Green', 'เขียว'], yellow: ['Yellow', 'เหลือง'], red: ['Red', 'แดง'] };

/**
 * @param pages [{ name, rows: string[][] (row 0 = headings), other: string[] }] in page order;
 *   a picture that could not be read ({ error }) is left out but keeps its number
 * @param lit the traffic lights (picture/lights.js) for these pages as they stand, or null:
 *   then each line gets its light and why, and a Checks sheet says what was checked
 * @param lang 'th': our words in Thai only (what was read stays as read); otherwise English · Thai
 * @returns {Uint8Array} the .xlsx file
 */
export function pictureWorkbook(pages, lit = null, typed = {}, lang = 'en') {
  const th = lang === 'th';
  const L = (en, t) => (th ? t : `${en} · ${t}`);
  const say = text => (th ? thai(text) : text);
  const WORD = { none: '-', ...Object.fromEntries(Object.entries(WORDS).map(([k, [en, t]]) => [k, L(en, t)])) };
  const width = Math.max(1, ...pages.map(p => Math.max(0, ...(p.rows ?? []).map(r => r.length))));
  const table = new Sheet(th ? 'ตาราง' : 'Table', { widths: [18, ...(lit ? [14] : []), ...Array(width).fill(18), ...(lit ? [70] : [])], freezeRows: 2 });
  table.add(new Cell(L('Read from statement pictures on this computer - check every figure against the picture before using it.',
    'อ่านจากรูปใบแจ้งยอดในเครื่องนี้ ตรวจทุกตัวเลขเทียบกับรูปก่อนใช้'), BAD));
  // the first picture's headings head the sheet; a later picture whose headings
  // differ gets its own heading row, so no column is silently mislabelled
  let shown = null;
  pages.forEach((p, k) => {
    if (p.error || !p.rows?.length) return;
    const [head = [], ...lines] = p.rows;
    const key = head.join('|');
    if (key !== shown) {
      table.add(new Cell(shown === null ? L('Picture', 'รูป') : clean(th ? `รูป (หัวตารางของ ${p.name})` : `Picture · รูป (headings of ${p.name})`), HEADER),
        ...(lit ? [new Cell(L('Light', 'สถานะ'), HEADER)] : []),
        ...head.map(h => new Cell(clean(h), HEADER)), ...(lit ? [...Array(width - head.length).fill(new Cell('', HEADER)), new Cell(L('Why', 'เหตุผล'), HEADER)] : []));
      shown = key;
    }
    lines.forEach((line, j) => {
      const l = lit?.rows[k]?.[j + 1];
      const cells = line.map(c => new Cell(clean(c)));
      if (!lit) return table.add(new Cell(clean(`${k + 1}. ${p.name}`)), ...cells);
      table.add(new Cell(clean(`${k + 1}. ${p.name}`)), new Cell(l ? WORD[l.light] : '-', FILL[l?.light] ?? 0),
        ...cells, ...Array(width - line.length).fill(new Cell('')), new Cell(say(l?.why ?? '')));
    });
  });
  const other = new Sheet(th ? 'ข้อความอื่น' : 'Other text', { widths: [24, 100] });
  other.add(new Cell(L('Picture', 'รูป'), HEADER), new Cell(L('Writing outside the table', 'ข้อความนอกตาราง'), HEADER));
  pages.forEach((p, k) => { for (const t of p.other ?? []) other.add(clean(`${k + 1}. ${p.name}`), clean(t)); });
  if (!lit) return writeXlsx([table, other]);
  // What was checked, and the light for the whole set, for whoever opens the file later.
  const checks = new Sheet(th ? 'การตรวจ' : 'Checks', { widths: [44, 12, 100] });
  checks.add(new Cell(L('All pictures', 'ทุกรูป'), BOLD), new Cell(WORD[lit.set.light], FILL[lit.set.light]), new Cell(say(lit.set.headline), BOLD));
  const { green, yellow, red } = lit.set.counts;
  checks.add(L('Lines', 'บรรทัด'), '', th ? `เขียว ${green} · เหลือง ${yellow} · แดง ${red}` : `${green} green · ${yellow} yellow · ${red} red`);
  checks.add(L('Opening balance typed', 'ยอดยกมาที่กรอก'), '', typed.openingText || (th ? '(ไม่ได้กรอก)' : '(not typed)'));
  checks.add(L('Closing balance typed', 'ยอดคงเหลือปลายงวดที่กรอก'), '', typed.closingText || (th ? '(ไม่ได้กรอก)' : '(not typed)'));
  for (const w of lit.warnings ?? []) checks.add(new Cell(L('Check by eye', 'ตรวจด้วยตา'), BAD), '', th ? w.th : `${w.en} · ${w.th}`);
  checks.add('');
  checks.add(new Cell(L('Check', 'การตรวจ'), HEADER), new Cell(L('Result', 'ผล'), HEADER), new Cell(L('Detail', 'รายละเอียด'), HEADER));
  for (const c of lit.checks) checks.add(say(c.label), new Cell(c.passed ? L('Passed', 'ผ่าน') : L('Failed', 'ไม่ผ่าน'), c.passed ? LIGHT_GREEN : LIGHT_RED), say(c.detail ?? ''));
  return writeXlsx([table, other, checks], { lights: true });
}
