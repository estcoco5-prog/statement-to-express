// Read a spreadsheet someone else made (an .xlsx or a .csv - for example from
// a picture-to-Excel website) into plain rows of cells. Browser and Node alike;
// nothing leaves the device. Values come back as strings, or numbers where the
// file stored a number (Excel keeps dates as day numbers - see table/columns.js).

export class TableError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// Limits, so a broken or hostile file cannot freeze the page (G8 Excel review
// S4). A real statement page is far below every one of them.
export const LIMITS = { fileBytes: 20e6, partBytes: 50e6, totalBytes: 100e6, sheets: 50, columns: 256, rows: 100000 };   // a busy account's year: TTB printed 4,474 lines in one month
const tooBig = what => new TableError('too-big', `the file is too large (${what})`);

// Unpacks one part, stopping as soon as it grows past the limit.
async function inflate(bytes, budget) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    budget.used += value.length;
    if (total > LIMITS.partBytes || budget.used > LIMITS.totalBytes) { reader.cancel().catch(() => {}); throw tooBig('unpacked'); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// The files inside a ZIP (an .xlsx is one): name -> bytes, read lazily.
export function unzip(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new TableError('not-table', 'not a ZIP / xlsx file');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries = new Map();
  const budget = { used: 0 };                     // unpacked bytes across ALL parts
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (u32(bytes, p) !== 0x02014b50) throw new TableError('not-table', 'damaged ZIP directory');
    const method = u16(bytes, p + 10), size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, async () => {
      const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data, budget);
      throw new TableError('not-table', `unsupported compression in ${name}`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
// The parts of xml between each opening tag and its close, in ONE forward pass:
// a missing close tag ends the part at the next opening tag, and never makes the
// reader search the rest of the file again (G8 re-review: no slow-down attack).
const parts = (xml, open, close) => xml.split(open).slice(1).map(p => {
  const end = p.indexOf(close);
  return end < 0 ? p : p.slice(0, end);
});
const inner = part => part.slice(part.indexOf('>') + 1);         // drop the tag's own attributes
const textOf = xml => parts(xml, /<t(?=[\s>])/, '</t>').map(p => unxml(inner(p))).join('');
const colIndex = ref => {
  const letters = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

// Every sheet of an .xlsx, in workbook order: [{ name, rows: [[cell, ...], ...] }].
export async function readXlsx(bytes) {
  const zip = unzip(bytes);
  const unpacked = new Map();
  const text = async name => {
    if (!zip.has(name)) return null;
    if (!unpacked.has(name)) unpacked.set(name, new TextDecoder().decode(await zip.get(name)()));
    return unpacked.get(name);
  };
  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new TableError('not-table', 'no workbook inside');
  // Old Mac Excel counts dates from 1904: read from 1900, every date would come
  // out 4 years and a day early, and still look real (G8 review 7 B-2).
  if (/<(?:\w+:)?workbookPr\b[^>]*\bdate1904\s*=\s*["'](1|true)["']/.test(workbook)) throw new TableError('date-1904', 'dates counted from 1904');
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target[id] = t.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const shared = [];
  const sst = await text('xl/sharedStrings.xml');
  if (sst) for (const si of parts(sst, /<si>/, '</si>')) {
    if (shared.length >= LIMITS.rows * LIMITS.columns) throw tooBig('text');
    shared.push(textOf(si));
  }

  const sheets = [];
  let total = 0;                                   // rows across ALL sheets
  const listed = [...workbook.matchAll(/<sheet\b[^>]*>/g)];
  if (listed.length > LIMITS.sheets) throw tooBig('sheets');
  for (const m of listed) {
    const name = unxml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const xml = await text(`xl/${target[rid] ?? ''}`);
    if (!xml) continue;
    const rows = [];
    for (const row of parts(xml, /<row(?=[\s>])/, '</row>')) {
      if (++total > LIMITS.rows) throw tooBig('rows');
      const cells = [];
      for (const c of parts(inner(row), /<c(?=[\s>/])/, '</c>')) {
        if (cells.length > LIMITS.columns) throw tooBig('columns');
        const tagEnd = c.indexOf('>');
        const attrs = tagEnd < 0 ? c : c.slice(0, tagEnd);
        const body = tagEnd < 0 || attrs.endsWith('/') ? '' : c.slice(tagEnd + 1);
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
        if (ref && ref.length > 3) throw tooBig('columns');
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = body.includes('<v>') ? parts(body, /<v>/, '</v>')[0] : undefined;
        let value = '';
        if (type === 's') value = shared[+v] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'str' || type === 'e') value = unxml(v ?? '');
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined && v !== '') value = Number(v);
        const at = ref ? colIndex(ref) : cells.length;
        if (at >= LIMITS.columns) throw tooBig('columns');
        while (cells.length < at) cells.push('');
        cells[at] = value;
      }
      rows.push(cells);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

// A CSV (comma, semicolon or tab - whichever the first line uses most).
export function readCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = [',', ';', '\t'].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; if (row.length > LIMITS.columns) throw tooBig('columns'); }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length > LIMITS.rows) throw tooBig('rows');
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (rows.length > LIMITS.rows) throw tooBig('rows');
  if (rows.some(r => r.length > LIMITS.columns)) throw tooBig('columns');
  return [{ name: 'csv', rows }];
}

// Text from a bank's export: UTF-8, or else the Thai Windows code page
// (TIS-620 / windows-874) many Thai bank systems still write - read as UTF-8,
// its Thai would come out as question marks.
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-874').decode(bytes);
  }
}

// An HTML table saved with an .xls name (some bank systems "export to Excel"
// this way): each <tr> a row, each <td>/<th> a cell, tags and entities removed.
export function readHtmlTable(text) {
  const entity = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const clean = s => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#'
      ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : entity[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ').trim();
  const rows = [];
  for (const [, tr] of text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    rows.push([...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, c]) => clean(c)));
    if (rows.length > LIMITS.rows) throw tooBig('rows');
  }
  if (rows.some(r => r.length > LIMITS.columns)) throw tooBig('columns');
  if (!rows.length) throw new TableError('not-table', 'no table in the file');
  return [{ name: 'html', rows }];
}

// An .xls name says little: a real Excel 97-2003 file, an HTML table, or text.
async function readOldExcel(bytes) {
  const { isCompoundFile, readXls } = await import('./xls.js');
  if (isCompoundFile(bytes)) return readXls(bytes);
  const text = decodeText(bytes).replace(/^﻿/, '');
  if (/^\s*</.test(text)) return readHtmlTable(text);
  if (/[,;\t]/.test(text.split(/\r?\n/, 1)[0])) return readCsv(text);
  throw new TableError('old-xls', 'an .xls file this app cannot read');
}

// Rows looked at for this app's own markers: a user may add rows above them.
const OWN_WINDOW = 25;
// This app's own Picture -> Excel file: what held its lines (a date the
// reader was unsure of) is not in the cells, so checking it again here could
// send them. It is converted on the Picture card instead (G8 picture-v2
// release review). The light column was headed ไฟ before 2026-10-14 (now
// สถานะ): both are known. A bare สถานะ is not a marker - another tool's sheet
// may well have a status column.
const PICTURE_MARK = /^Light · (?:ไฟ|สถานะ)$|^ไฟ$|^Read from statement pictures on this computer|^อ่านจากรูปใบแจ้งยอดในเครื่องนี้/;
// This app's own Review workbook (any card): its Check column says why a line
// was held, but this card does not read it, so held lines could be sent
// (G8 #9). Known by its headings, English or Thai, and by its Proof sheet, so
// a sheet removed, or Transactions saved alone as CSV, is still known.
const REVIEW_HEADS = [
  ['Check', ['Date', 'Time', 'Description', 'Withdrawal', 'Deposit', 'Balance', 'Channel', 'Details',
    'Transactions', 'Withdrawals', 'Deposits', 'Net change', 'Closing balance']],
  ['ผลตรวจ', ['วันที่', 'เวลา', 'รายการ', 'ถอน', 'ฝาก', 'ยอดคงเหลือ', 'ช่องทาง', 'รายละเอียด',
    'จำนวนรายการ', 'เปลี่ยนแปลงสุทธิ', 'ยอดคงเหลือปลายงวด']],
];
const REVIEW_MARK = /^(?:How this file was checked|ไฟล์นี้ตรวจอย่างไร|The rule every row is tested against|กฎที่ใช้ตรวจทุกรายการ)$/;

// The Thai picture file's heading row (Picture, Light, Why) once its first
// row, the warning, is deleted.
const PICTURE_HEADS = ['รูป', 'สถานะ', 'เหตุผล'];

/** 'own-picture-file', 'own-review-file', or null for anyone else's table. */
export function ownFileKind(sheets) {
  const text = c => String(c ?? '').trim();
  for (const s of sheets) {
    const top = s.rows.slice(0, OWN_WINDOW);
    for (const [i, row] of top.entries()) {
      const cells = row.map(text);
      if (cells.some(c => PICTURE_MARK.test(c)) || PICTURE_HEADS.every(h => cells.includes(h))) return 'own-picture-file';
      if (cells.some(c => REVIEW_MARK.test(c))) return 'own-review-file';
      // a heading row: the Check column beside at least three of its
      // neighbours, holding words (OK, or why) - a bank's cheque column holds numbers
      for (const [check, heads] of REVIEW_HEADS) {
        const at = cells.indexOf(check);
        if (at < 0 || heads.filter(h => cells.includes(h)).length < 3) continue;
        if (s.rows.slice(i + 1).some(r => /[^\d\s.,-]/.test(text(r[at])))) return 'own-review-file';
      }
    }
  }
  return null;
}

// A password-locked .xlsx is not a zip but a compound file holding an
// EncryptionInfo stream. It is refused, not unlocked: the team does not send
// locked files (Co 2026-10-16), so it only needs to say why.
const ENCRYPTED = [...'EncryptionInfo'].flatMap(ch => [ch.charCodeAt(0), 0]);
export function isLockedExcel(bytes) {
  const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.length < 512 || !MAGIC.every((v, i) => bytes[i] === v)) return false;
  outer: for (let i = 0; i <= bytes.length - ENCRYPTED.length; i++) {
    for (let j = 0; j < ENCRYPTED.length; j++) if (bytes[i + j] !== ENCRYPTED[j]) continue outer;
    return true;
  }
  return false;
}

/** A chosen file -> its sheets: .xlsx, .xls (Excel 97-2003, or an HTML/text export so named), .csv. */
export async function readTableFile(name, bytes) {
  if (bytes.length > LIMITS.fileBytes) throw tooBig('bytes');
  if (isLockedExcel(bytes)) throw new TableError('locked-excel', 'a password-locked Excel file');
  const sheets = /\.xls$/i.test(name) ? await readOldExcel(bytes)
    : /\.(csv|txt)$/i.test(name) ? await readCsv(decodeText(bytes)) : await readXlsx(bytes);
  const own = ownFileKind(sheets);
  if (own) throw new TableError(own, own === 'own-review-file'
    ? 'a Review workbook from this app' : 'a Picture -> Excel file from this app');
  return sheets;
}
