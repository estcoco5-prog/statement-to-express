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
export const LIMITS = { fileBytes: 20e6, partBytes: 50e6, totalBytes: 100e6, sheets: 50, columns: 256, rows: 20000 };
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

/** A chosen file -> its sheets. Old .xls (binary) cannot be read: save it as .xlsx. */
export async function readTableFile(name, bytes) {
  if (/\.xls$/i.test(name)) throw new TableError('old-xls', 'old .xls file');
  if (bytes.length > LIMITS.fileBytes) throw tooBig('bytes');
  if (/\.(csv|txt)$/i.test(name)) return readCsv(new TextDecoder('utf-8').decode(bytes));
  return readXlsx(bytes);
}
