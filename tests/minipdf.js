// Builds tiny one-page PDFs for tests - made-up content only.
//   miniPdf(lines)                       Helvetica text: [[x, yFromTop, text], ...]
//   miniPdf(lines, { password: 'pw' })   the same, locked (PDF Standard security,
//                                        revision 2: RC4-40 + MD5 - what pdf.js opens)
//   miniPdf([], { image: true })         a page that is a picture only, no text
//   miniPdf([[x, y, [[printed, actual], ...]]])  pieces wrapped in ActualText spans
import { createHash } from 'node:crypto';

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
const padPw = pw => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);

function rc4(key, data) {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// A UTF-16BE PDF string with its byte-order mark, as real statements write ActualText.
const utf16 = s => '<FEFF' + [...s].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>';

export function miniPdf(lines, { password = null, image = false } = {}) {
  const esc = t => t.replace(/[\\()]/g, m => '\\' + m);
  // [x, y, [[printed, actual], ...]]: each printed piece is wrapped in its own
  // ActualText span - the way UOB's statements carry the real letters of a font
  // whose own letter map is blank. `actual: null` prints the piece with no span.
  const line = ([x, y, t]) => (Array.isArray(t)
    ? `BT /F1 10 Tf ${x} ${842 - y} Td ` + t.map(([printed, actual]) => (actual === null
      ? `(${esc(printed)}) Tj`
      : `/Span << /ActualText ${utf16(actual)} >> BDC (${esc(printed)}) Tj EMC`)).join(' ') + ' ET'
    : `BT /F1 10 Tf ${x} ${842 - y} Td (${esc(t)}) Tj ET`);
  let content = lines.map(line).join('\n');
  if (image) content += `${content ? '\n' : ''}q 595 0 0 842 0 0 cm /Im1 Do Q`;
  let contentBytes = Buffer.from(content, 'latin1');
  const pixel = Buffer.from([0x80]);                       // a 1x1 grey picture

  const fileId = md5(Buffer.from('made-up test file'));
  let encryptDict = null;
  const P = -44;                                           // permissions: print etc.
  const pBytes = Buffer.alloc(4); pBytes.writeInt32LE(P);
  let fileKey = null;
  if (password !== null) {
    const O = rc4(md5(padPw(password)).subarray(0, 5), padPw(password));
    fileKey = md5(padPw(password), O, pBytes, fileId).subarray(0, 5);
    const U = rc4(fileKey, PAD);
    encryptDict = `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>`;
  }
  const objKey = num => md5(fileKey, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 10);
  const enc = (num, bytes) => (fileKey ? rc4(objKey(num), bytes) : bytes);

  contentBytes = enc(5, contentBytes);
  const imageBytes = enc(6, pixel);
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> ' +
      '/XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.concat([Buffer.from(`<< /Length ${contentBytes.length} >>\nstream\n`), contentBytes, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray ' +
      `/BitsPerComponent 8 /Length ${imageBytes.length} >>\nstream\n`), imageBytes, Buffer.from('\nendstream')]),
  ];
  if (encryptDict) objs.push(Buffer.from(encryptDict));

  const parts = [Buffer.from('%PDF-1.4\n')];
  let length = parts[0].length;
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    parts.push(chunk); length += chunk.length;
  });
  let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) tail += `${String(o).padStart(10, '0')} 00000 n \n`;
  const id = fileId.toString('hex');
  tail += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /ID [<${id}> <${id}>]` +
    (encryptDict ? ` /Encrypt ${objs.length} 0 R` : '') + ` >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(tail));
  return new Uint8Array(Buffer.concat(parts));
}
