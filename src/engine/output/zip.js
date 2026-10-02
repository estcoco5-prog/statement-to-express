// A minimal ZIP writer: stored (uncompressed) entries, UTF-8 names, a fixed
// timestamp - so the same workbook always produces the same bytes. An .xlsx
// is a ZIP of XML parts, and Excel reads stored entries fine.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const UTF8 = 0x0800;          // general-purpose flag: names are UTF-8
const DOS_DATE = 0x0021;      // 1980-01-01, time 00:00

export function zipStore(files) {
  const enc = new TextEncoder();
  const entries = files.map(f => {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    return { name, data, crc: crc32(data) };
  });
  const localSize = entries.reduce((s, e) => s + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((s, e) => s + 46 + e.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const dv = new DataView(out.buffer);
  let p = 0;
  const offsets = [];
  for (const e of entries) {
    offsets.push(p);
    dv.setUint32(p, 0x04034b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, UTF8, true);
    dv.setUint16(p + 8, 0, true); dv.setUint16(p + 10, 0, true); dv.setUint16(p + 12, DOS_DATE, true);
    dv.setUint32(p + 14, e.crc, true); dv.setUint32(p + 18, e.data.length, true);
    dv.setUint32(p + 22, e.data.length, true); dv.setUint16(p + 26, e.name.length, true);
    dv.setUint16(p + 28, 0, true);
    out.set(e.name, p + 30); out.set(e.data, p + 30 + e.name.length);
    p += 30 + e.name.length + e.data.length;
  }
  const centralStart = p;
  entries.forEach((e, i) => {
    dv.setUint32(p, 0x02014b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, UTF8, true); dv.setUint16(p + 10, 0, true); dv.setUint16(p + 12, 0, true);
    dv.setUint16(p + 14, DOS_DATE, true); dv.setUint32(p + 16, e.crc, true);
    dv.setUint32(p + 20, e.data.length, true); dv.setUint32(p + 24, e.data.length, true);
    dv.setUint16(p + 28, e.name.length, true);
    // extra, comment, disk, internal and external attributes: all zero
    dv.setUint32(p + 42, offsets[i], true);
    out.set(e.name, p + 46);
    p += 46 + e.name.length;
  });
  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 8, entries.length, true); dv.setUint16(p + 10, entries.length, true);
  dv.setUint32(p + 12, p - centralStart, true); dv.setUint32(p + 16, centralStart, true);
  return out;
}
