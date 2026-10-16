// An old Excel 97-2003 .xls (Co 2026-10-16: KBank K-BIZ exports this) -> the
// same { name, rows } sheets as an .xlsx. Browser and Node alike; nothing
// leaves the device. Two layers: the "compound file" (a small file system
// inside the file) holds a stream named Workbook; that stream is a list of
// BIFF8 records - the sheet names, a shared table of texts, and one record per
// cell. Only cell VALUES are read (text, numbers, formula results); formats,
// fonts and charts are skipped. Dates come back as Excel day numbers, as from
// an .xlsx, and table/columns.js reads them the same way.
import { TableError, LIMITS } from './read.js';

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const damaged = why => new TableError('not-table', `damaged .xls file (${why})`);

export const isCompoundFile = bytes => bytes.length >= 512 && MAGIC.every((v, i) => bytes[i] === v);

// ---- the compound file: find the Workbook stream ---------------------------------
function workbookStream(b) {
  const shift = u16(b, 0x1e), miniShift = u16(b, 0x20);
  if (shift < 7 || shift > 16 || miniShift > shift) throw damaged('sector size');
  const size = 1 << shift, miniSize = 1 << miniShift;
  const sector = n => (n + 1) * size;
  const cutoff = u32(b, 0x38);

  // The sector table (FAT): its own sectors are listed in the header, then in a chain.
  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const s = u32(b, 0x4c + i * 4); if (s < END - 3) fatSectors.push(s); }
  for (let s = u32(b, 0x44), guard = 0; s < END - 3 && guard < 10000; guard++) {
    const at = sector(s);
    for (let i = 0; i < size / 4 - 1; i++) { const f = u32(b, at + i * 4); if (f < END - 3) fatSectors.push(f); }
    s = u32(b, at + size - 4);
  }
  const fat = [];
  for (const s of fatSectors) for (let i = 0; i < size / 4; i++) fat.push(u32(b, sector(s) + i * 4));

  const chain = (start, table) => {
    const out = [], seen = new Set();
    for (let s = start; s < END - 3; s = table[s]) {
      if (seen.has(s) || s >= table.length) throw damaged('sector chain');
      seen.add(s); out.push(s);
    }
    return out;
  };
  const read = (start, length) => {
    const out = new Uint8Array(length);
    let at = 0;
    for (const s of chain(start, fat)) {
      const from = sector(s);
      if (from + size > b.length && at + size <= length) throw damaged('past the end');
      const take = Math.min(size, length - at);
      out.set(b.subarray(from, from + take), at);
      at += take;
      if (at >= length) break;
    }
    return out;
  };

  // The directory: 128-byte entries; entry 0 is the root, which holds the small-stream area.
  const dirStart = u32(b, 0x30);
  const dirBytes = chain(dirStart, fat).length * size;
  const dir = read(dirStart, dirBytes);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = u16(dir, o + 64);
    let name = '';
    for (let i = 0; i + 2 < nameLen && i < 64; i += 2) name += String.fromCharCode(u16(dir, o + i));
    entries.push({ name, type: dir[o + 66], start: u32(dir, o + 116), size: u32(dir, o + 120) });
  }
  const root = entries[0];
  const book = entries.find(e => e.type === 2 && (e.name === 'Workbook' || e.name === 'Book'));
  if (!root || !book) throw new TableError('not-table', 'no workbook inside the .xls file');
  if (book.size > LIMITS.partBytes) throw new TableError('too-big', 'the file is too large (unpacked)');
  if (book.size >= cutoff) return read(book.start, book.size);

  // A small stream lives in the root's small-sector area, chained by the mini table.
  const miniFat = [];
  const miniStart = u32(b, 0x3c);
  if (miniStart < END - 3) {
    const raw = read(miniStart, chain(miniStart, fat).length * size);
    for (let i = 0; i + 4 <= raw.length; i += 4) miniFat.push(u32(raw, i));
  }
  const area = read(root.start, root.size);
  const out = new Uint8Array(book.size);
  let at = 0;
  for (const s of chain(book.start, miniFat)) {
    const take = Math.min(miniSize, book.size - at);
    out.set(area.subarray(s * miniSize, s * miniSize + take), at);
    at += take;
  }
  return out;
}

// ---- BIFF8 records ---------------------------------------------------------------
function records(w) {
  const out = [];
  for (let p = 0; p + 4 <= w.length;) {
    const type = u16(w, p), len = u16(w, p + 2);
    out.push({ type, at: p, data: w.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  return out;
}

// Characters, one byte each (flags bit 0 clear) or two (set).
function chars(d, o, count, wide) {
  let s = '';
  for (let i = 0; i < count; i++) s += String.fromCharCode(wide ? u16(d, o + i * 2) : d[o + i]);
  return [s, o + count * (wide ? 2 : 1)];
}

// A string inside one record (LABEL, STRING, sheet names): length, flags, characters.
function shortString(d, o, lenBytes = 2) {
  const count = lenBytes === 1 ? d[o] : u16(d, o);
  const flags = d[o + lenBytes];
  return chars(d, o + lenBytes + 1, count, flags & 1)[0];
}

// The shared strings table: it can run over into CONTINUE records, and a
// string cut there restarts with its own flags byte.
function sharedStrings(sst, continues) {
  const parts = [sst.subarray(8), ...continues];
  const total = u32(sst, 4);
  const out = [];
  let k = 0, d = parts[0], o = 0;
  const need = n => { if (o + n > d.length) { if (++k >= parts.length) throw damaged('strings'); d = parts[k]; o = 0; } };
  while (out.length < total) {
    if (o >= d.length) { if (++k >= parts.length) break; d = parts[k]; o = 0; }
    need(3);
    let left = u16(d, o);
    const flags = d[o + 2];
    o += 3;
    let runs = 0, ext = 0;
    if (flags & 8) { runs = u16(d, o); o += 2; }
    if (flags & 4) { ext = u32(d, o); o += 4; }
    let text = '', wide = flags & 1;
    while (left > 0) {
      if (o >= d.length) {
        if (++k >= parts.length) throw damaged('strings');
        d = parts[k]; o = 0;
        wide = d[o] & 1; o += 1;            // a continued string's own flags
      }
      const fit = Math.min(left, Math.floor((d.length - o) / (wide ? 2 : 1)));
      if (fit <= 0) throw damaged('strings');
      const [piece, next] = chars(d, o, fit, wide);
      text += piece; o = next; left -= fit;
    }
    // formatting runs and phonetic data after the text are skipped, across records too
    for (let skip = runs * 4 + ext; skip > 0;) {
      if (o >= d.length) { if (++k >= parts.length) break; d = parts[k]; o = 0; }
      const n = Math.min(skip, d.length - o);
      o += n; skip -= n;
    }
    out.push(text);
  }
  return out;
}

const f64 = (d, o) => new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);

// RK: a compressed number - an integer or the top half of a double, maybe /100.
function rk(v) {
  let n;
  if (v & 2) n = (v | 0) >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, v & 0xfffffffc, true);
    n = buf.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

/** .xls bytes -> [{ name, rows }] in sheet order (worksheets only). */
export function readXls(bytes) {
  if (!isCompoundFile(bytes)) throw new TableError('not-table', 'not an .xls file');
  const w = workbookStream(bytes);
  const recs = records(w);
  if (!recs.length || recs[0].type !== 0x0809 || u16(recs[0].data, 0) !== 0x0600) {
    throw new TableError('not-table', 'an Excel 5 or older .xls file (only Excel 97-2003 is read)');
  }
  if (recs.some(r => r.type === 0x002f)) throw new TableError('not-table', 'a password-protected .xls file');
  if (recs.some(r => r.type === 0x0022 && u16(r.data, 0) === 1)) {
    throw new TableError('date-1904', 'dates counted from 1904');
  }
  const sheets = [];
  let sst = [];
  for (let i = 0; i < recs.length && recs[i].type !== 0x000a; i++) {
    const r = recs[i];
    if (r.type === 0x0085 && r.data[5] === 0) {      // a worksheet (not a chart or macro sheet)
      sheets.push({ name: shortString(r.data, 6, 1), at: u32(r.data, 0) });
    } else if (r.type === 0x00fc) {
      const cont = [];
      for (let j = i + 1; j < recs.length && recs[j].type === 0x003c; j++) cont.push(recs[j].data);
      sst = sharedStrings(r.data, cont);
    }
  }
  if (sheets.length > LIMITS.sheets) throw new TableError('too-big', 'the file is too large (sheets)');

  const byAt = new Map(recs.map((r, i) => [r.at, i]));
  return sheets.map(({ name, at }) => {
    const rows = [];
    const put = (row, col, value) => {
      if (row >= LIMITS.rows) throw new TableError('too-big', 'the file is too large (rows)');
      if (col >= LIMITS.columns) throw new TableError('too-big', 'the file is too large (columns)');
      while (rows.length <= row) rows.push([]);
      const cells = rows[row];
      while (cells.length < col) cells.push('');
      cells[col] = value;
    };
    let formulaCell = null;
    for (let i = byAt.get(at) ?? recs.length; i < recs.length; i++) {
      const { type, data: d } = recs[i];
      if (type === 0x000a) break;                                          // EOF of this sheet
      if (type === 0x00fd) put(u16(d, 0), u16(d, 2), sst[u32(d, 6)] ?? '');   // LABELSST
      else if (type === 0x0204) put(u16(d, 0), u16(d, 2), shortString(d, 6)); // LABEL
      else if (type === 0x0203) put(u16(d, 0), u16(d, 2), f64(d, 6));         // NUMBER
      else if (type === 0x027e) put(u16(d, 0), u16(d, 2), rk(u32(d, 6)));     // RK
      else if (type === 0x00bd) {                                              // MULRK
        const row = u16(d, 0), first = u16(d, 2);
        for (let k = 0; 4 + k * 6 + 6 <= d.length - 2; k++) put(row, first + k, rk(u32(d, 4 + k * 6 + 2)));
      } else if (type === 0x0006) {                                            // FORMULA: its saved result
        const row = u16(d, 0), col = u16(d, 2);
        if (u16(d, 12) === 0xffff) {
          if (d[6] === 0) formulaCell = [row, col];                            // text: in the STRING record next
          else if (d[6] === 1) put(row, col, d[8] ? 'TRUE' : 'FALSE');
        } else put(row, col, f64(d, 6));
      } else if (type === 0x0207 && formulaCell) {                             // STRING
        put(formulaCell[0], formulaCell[1], shortString(d, 0));
        formulaCell = null;
      }
    }
    return { name, rows };
  });
}
