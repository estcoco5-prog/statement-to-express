// The tables read from statement pictures -> one Excel file, the way a person
// would type it up: one sheet with every picture's lines in order (a first
// column says which picture each line came from), and a second sheet with the
// rest of the writing on each picture (bank name, account, period, footer).
// Cells are text exactly as read: nothing is changed, rounded or guessed.
import { Sheet, Cell, HEADER, BAD, BOLD, writeXlsx, LIGHT_GREEN, LIGHT_YELLOW, LIGHT_RED } from '../engine/output/xlsx.js';

const FILL = { green: LIGHT_GREEN, yellow: LIGHT_YELLOW, red: LIGHT_RED };
// eslint-disable-next-line no-control-regex
const clean = v => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
const WORD = { green: 'Green · เขียว', yellow: 'Yellow · เหลือง', red: 'Red · แดง', none: '-' };

/**
 * @param pages [{ name, rows: string[][] (row 0 = headings), other: string[] }] in page order;
 *   a picture that could not be read ({ error }) is left out but keeps its number
 * @param lit the traffic lights (picture/lights.js) for these pages as they stand, or null:
 *   then each line gets its light and why, and a Checks sheet says what was checked
 * @returns {Uint8Array} the .xlsx file
 */
export function pictureWorkbook(pages, lit = null, typed = {}) {
  const width = Math.max(1, ...pages.map(p => Math.max(0, ...(p.rows ?? []).map(r => r.length))));
  const table = new Sheet('Table', { widths: [18, ...(lit ? [14] : []), ...Array(width).fill(18), ...(lit ? [70] : [])], freezeRows: 2 });
  table.add(new Cell('Read from statement pictures on this computer - check every figure against the picture before using it. · ' +
    'อ่านจากรูปใบแจ้งยอดในเครื่องนี้ ตรวจทุกตัวเลขเทียบกับรูปก่อนใช้', BAD));
  // the first picture's headings head the sheet; a later picture whose headings
  // differ gets its own heading row, so no column is silently mislabelled
  let shown = null;
  pages.forEach((p, k) => {
    if (p.error || !p.rows?.length) return;
    const [head = [], ...lines] = p.rows;
    const key = head.join('|');
    if (key !== shown) {
      table.add(new Cell(shown === null ? 'Picture · รูป' : clean(`Picture · รูป (headings of ${p.name})`), HEADER),
        ...(lit ? [new Cell('Light · ไฟ', HEADER)] : []),
        ...head.map(h => new Cell(clean(h), HEADER)), ...(lit ? [...Array(width - head.length).fill(new Cell('', HEADER)), new Cell('Why · เหตุผล', HEADER)] : []));
      shown = key;
    }
    lines.forEach((line, j) => {
      const l = lit?.rows[k]?.[j + 1];
      const cells = line.map(c => new Cell(clean(c)));
      if (!lit) return table.add(new Cell(clean(`${k + 1}. ${p.name}`)), ...cells);
      table.add(new Cell(clean(`${k + 1}. ${p.name}`)), new Cell(l ? WORD[l.light] : '-', FILL[l?.light] ?? 0),
        ...cells, ...Array(width - line.length).fill(new Cell('')), new Cell(l?.why ?? ''));
    });
  });
  const other = new Sheet('Other text', { widths: [24, 100] });
  other.add(new Cell('Picture · รูป', HEADER), new Cell('Writing outside the table · ข้อความนอกตาราง', HEADER));
  pages.forEach((p, k) => { for (const t of p.other ?? []) other.add(clean(`${k + 1}. ${p.name}`), clean(t)); });
  if (!lit) return writeXlsx([table, other]);
  // What was checked, and the light for the whole set, for whoever opens the file later.
  const checks = new Sheet('Checks', { widths: [44, 12, 100] });
  checks.add(new Cell('All pictures · ทุกรูป', BOLD), new Cell(WORD[lit.set.light], FILL[lit.set.light]), new Cell(lit.set.headline, BOLD));
  checks.add('Lines · บรรทัด', '', `${lit.set.counts.green} green · ${lit.set.counts.yellow} yellow · ${lit.set.counts.red} red`);
  checks.add('Opening balance typed · ยอดยกมาที่พิมพ์', '', typed.openingText || '(not typed)');
  checks.add('Closing balance typed · ยอดคงเหลือที่พิมพ์', '', typed.closingText || '(not typed)');
  for (const w of lit.warnings ?? []) checks.add(new Cell('Check by eye · ตรวจด้วยตา', BAD), '', `${w.en} · ${w.th}`);
  checks.add('');
  checks.add(new Cell('Check · การตรวจ', HEADER), new Cell('Result · ผล', HEADER), new Cell('Detail · รายละเอียด', HEADER));
  for (const c of lit.checks) checks.add(c.label, new Cell(c.passed ? 'Passed · ผ่าน' : 'Failed · ไม่ผ่าน', c.passed ? LIGHT_GREEN : LIGHT_RED), c.detail ?? '');
  return writeXlsx([table, other, checks], { lights: true });
}
