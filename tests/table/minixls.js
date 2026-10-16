// Builds tiny Excel 97-2003 (.xls) files for tests - made-up content only.
//   miniXls([[cell, ...], ...], { big, splitText })
// A cell is a string (shared text), a number (a NUMBER record), or
// { rk: n } / { rk100: n } for the two compressed number forms. `big` pads the
// workbook past 4096 bytes, so it is stored in ordinary sectors rather than
// the small-stream area. `splitText` cuts the shared-text table into a
// CONTINUE record in the middle of the first text.
const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const rec = (type, data) => Buffer.concat([u16(type), u16(data.length), data]);
const wide = s => Buffer.concat([...s].map(c => u16(c.charCodeAt(0))));
const bof = dt => rec(0x0809, Buffer.concat([u16(0x0600), u16(dt), Buffer.alloc(12)]));
const EOF = rec(0x000a, Buffer.alloc(0));

function rkOf(n, by100) {
  const v = by100 ? Math.round(n * 100) : n;
  return ((v << 2) | 2 | (by100 ? 1 : 0)) >>> 0;
}

function workbook(rows, { splitText = false } = {}) {
  const texts = [...new Set(rows.flat().filter(c => typeof c === 'string'))];
  const strings = texts.map(t => Buffer.concat([u16(t.length), Buffer.from([1]), wide(t)]));
  let sst = Buffer.concat([u32(texts.length), u32(texts.length), ...strings]);
  let sstRecords;
  if (splitText && texts[0]?.length > 2) {
    // cut inside the first text: the CONTINUE starts with that text's flags byte again
    const cut = 8 + 3 + 2 * 2;
    sstRecords = Buffer.concat([rec(0x00fc, sst.subarray(0, cut)), rec(0x003c, Buffer.concat([Buffer.from([1]), sst.subarray(cut)]))]);
  } else sstRecords = rec(0x00fc, sst);

  const cells = [];
  rows.forEach((row, r) => row.forEach((c, k) => {
    if (c === '' || c === null || c === undefined) return;
    const at = Buffer.concat([u16(r), u16(k), u16(0)]);
    if (typeof c === 'string') cells.push(rec(0x00fd, Buffer.concat([at, u32(texts.indexOf(c))])));
    else if (typeof c === 'number') { const f = Buffer.alloc(8); f.writeDoubleLE(c); cells.push(rec(0x0203, Buffer.concat([at, f]))); }
    else if ('rk' in c) cells.push(rec(0x027e, Buffer.concat([at, u32(rkOf(c.rk, false))])));
    else cells.push(rec(0x027e, Buffer.concat([at, u32(rkOf(c.rk100, true))])));
  }));
  const sheet = Buffer.concat([bof(0x0010), ...cells, EOF]);
  const name = Buffer.from('Sheet1', 'latin1');
  const boundSize = 4 + 4 + 2 + 1 + 1 + name.length;
  const globalsLen = bof(0x0005).length + boundSize + sstRecords.length + EOF.length;
  const bound = rec(0x0085, Buffer.concat([u32(globalsLen), u16(0), Buffer.from([name.length, 0]), name]));
  return Buffer.concat([bof(0x0005), bound, sstRecords, EOF, sheet]);
}

const END = 0xfffffffe, FREE = 0xffffffff, FATSECT = 0xfffffffd, NONE = 0xffffffff;
function dirEntry(name, type, start, size, child = NONE) {
  const e = Buffer.alloc(128);
  wide(name).copy(e, 0);
  e.writeUInt16LE((name.length + 1) * 2, 64);
  e[66] = type;
  e.writeUInt32LE(NONE, 68); e.writeUInt32LE(NONE, 72); e.writeUInt32LE(child, 76);
  e.writeUInt32LE(start, 116); e.writeUInt32LE(size, 120);
  return e;
}
const pad = (b, n) => Buffer.concat([b, Buffer.alloc((n - (b.length % n)) % n)]);

export function miniXls(rows, { big = false, splitText = false } = {}) {
  let stream = workbook(rows, { splitText });
  if (big) stream = Buffer.concat([stream, Buffer.alloc(Math.max(0, 5000 - stream.length))]);
  const header = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x3e, 0x18); header.writeUInt16LE(3, 0x1a); header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e); header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c);           // one FAT sector
  header.writeUInt32LE(1, 0x30);           // the directory is sector 1
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(END, 0x44); header.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i === 0 ? 0 : FREE, 0x4c + i * 4);

  const fat = new Array(128).fill(FREE);
  fat[0] = FATSECT; fat[1] = END;
  let sectors, dir;
  if (big) {
    const data = pad(stream, 512);
    const n = data.length / 512;
    for (let i = 0; i < n; i++) fat[2 + i] = i === n - 1 ? END : 3 + i;
    header.writeUInt32LE(END, 0x3c); header.writeUInt32LE(0, 0x40);
    dir = Buffer.concat([dirEntry('Root Entry', 5, END, 0, 1), dirEntry('Workbook', 2, 2, stream.length), Buffer.alloc(256)]);
    sectors = [dir, data];
  } else {
    const mini = pad(stream, 64);
    const m = mini.length / 64;
    const miniFat = new Array(128).fill(FREE);
    for (let i = 0; i < m; i++) miniFat[i] = i === m - 1 ? END : i + 1;
    fat[2] = END;                                           // the mini table: sector 2
    const area = pad(mini, 512), a = area.length / 512;
    for (let i = 0; i < a; i++) fat[3 + i] = i === a - 1 ? END : 4 + i;
    header.writeUInt32LE(2, 0x3c); header.writeUInt32LE(1, 0x40);
    dir = Buffer.concat([dirEntry('Root Entry', 5, 3, mini.length, 1), dirEntry('Workbook', 2, 0, stream.length), Buffer.alloc(256)]);
    sectors = [dir, Buffer.concat(miniFat.map(u32)), area];
  }
  return new Uint8Array(Buffer.concat([header, Buffer.concat(fat.map(u32)), ...sectors]));
}
