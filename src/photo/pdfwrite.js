// The readable PDF: the photo as the visible page, the words as invisible text
// exactly where they sit, so Tool B reads it like any bank PDF. The same
// hand-written approach as Pic-to-PDF's js/pdf.js - no PDF library.
import { TOOL_A_PRODUCER, BANK_NOTE } from '../engine/source.js';

export { TOOL_A_PRODUCER };
const FONT_SIZE = 10;
const GLYPH_WIDTH = 500;         // every glyph is declared 500/1000 em wide

const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');

/**
 * Read a JPEG's pixel dimensions from its frame header (copied from
 * Pic-to-PDF js/pdf.js).
 * @returns {{w:number,h:number,progressive:boolean}}
 */
export function jpegSize(buf) {
  const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (d[0] !== 0xff || d[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i + 3 < d.length) {
    if (d[i] !== 0xff) throw new Error(`corrupt JPEG: expected a marker at byte ${i}`);
    const m = d[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (d[i + 2] << 8) | d[i + 3];
    // SOF0/1/2/3/5/6/7/9/10/11/13/14/15 are frame headers; c4/c8/cc are not.
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return {
        h: (d[i + 5] << 8) | d[i + 6],
        w: (d[i + 7] << 8) | d[i + 8],
        progressive: m === 0xc2,
      };
    }
    if (len < 2) throw new Error('corrupt JPEG: bad segment length');
    i += 2 + len;
  }
  throw new Error('no frame header (SOF) found in JPEG');
}

// Invisible text (render mode 3), one Tj per word, stretched with Tz so its
// width on the page equals the word's measured width.
function textLayer(words, pageHeight) {
  const ops = ['BT', '3 Tr', `/F1 ${FONT_SIZE} Tf`];
  for (const w of words) {
    const cids = [...w.text].map(ch => ch.codePointAt(0)).filter(cp => cp <= 0xffff);
    if (!cids.length) continue;
    // Readers give combining marks (Thai tone marks and upper/lower vowels) no
    // width, so only the spacing letters count towards the stretch.
    const spacing = [...w.text].filter(ch => !/\p{M}/u.test(ch)).length || 1;
    const natural = spacing * GLYPH_WIDTH / 1000 * FONT_SIZE;       // width at 100% scaling
    const tz = 100 * (w.x1 - w.x0) / natural;
    const baseline = pageHeight - w.y1 + (w.y1 - w.y0) * 0.2;       // a little above the box bottom
    ops.push(`${tz.toFixed(3)} Tz`, `1 0 0 1 ${w.x0.toFixed(2)} ${baseline.toFixed(2)} Tm`,
      `<${cids.map(hex4).join('')}> Tj`);
  }
  ops.push('ET');
  return ops.join('\n');
}

// Maps every code used back to its own Unicode character: the "glyphless"
// font has no shapes, only this map, which is all a text reader needs.
function toUnicode(cids) {
  const lines = [...cids].sort((a, b) => a - b).map(c => `<${hex4(c)}> <${hex4(c)}>`);
  const chunks = [];
  for (let i = 0; i < lines.length; i += 100) {
    const part = lines.slice(i, i + 100);
    chunks.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`);
  }
  return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    chunks.join('\n') + '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
}

/**
 * @param {Array<{jpeg:Uint8Array, width:number, height:number, words:Array}>} pages
 *        page size in points; words in points, y measured from the top
 * @param {{bank?:string, summaryPages?:number[]}} [options] the bank key the photo
 *        step recognised; which pages (0-based) are summary pages
 * @returns {Uint8Array} the complete PDF file
 */
export function buildReadablePdf(pages, { bank = null, summaryPages = [] } = {}) {
  if (!pages.length) throw new Error('a PDF needs at least one page');
  if (summaryPages.length >= pages.length) throw new Error('only summary pages - no transactions to read');
  const note = bank === null ? '' : `bank:${bank}` + (summaryPages.length ? ` summary:${summaryPages.map(i => i + 1).join(',')}` : '');
  if (note && !BANK_NOTE.test(note)) throw new Error(`not a bank key: ${bank}`);
  const chunks = [], offsets = [0];
  let pos = 0;
  const put = c => { const b = typeof c === 'string' ? ascii(c) : c; chunks.push(b); pos += b.length; };
  const object = (n, dict, stream) => {
    offsets[n] = pos;
    put(`${n} 0 obj\n${dict}\n`);
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
    put('endobj\n');
  };
  const used = new Set(pages.flatMap(p => p.words.flatMap(w => [...w.text].map(c => c.codePointAt(0))))
    .filter(cp => cp <= 0xffff));

  put('%PDF-1.4\n'); put(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  // 1 catalog, 2 pages, 3 info, 4 font, 5 descendant, 6 descriptor, 7 ToUnicode, then 3 per page.
  const pageIds = pages.map((_, i) => 8 + i * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map(n => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, `<< /Producer (${TOOL_A_PRODUCER}) /Creator (${TOOL_A_PRODUCER})${note ? ` /Subject (${note})` : ''} >>`);
  object(4, '<< /Type /Font /Subtype /Type0 /BaseFont /GlyphLess /Encoding /Identity-H ' +
    '/DescendantFonts [5 0 R] /ToUnicode 7 0 R >>');
  object(5, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /GlyphLess ' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
    `/FontDescriptor 6 0 R /DW ${GLYPH_WIDTH} /CIDToGIDMap /Identity >>`);
  object(6, '<< /Type /FontDescriptor /FontName /GlyphLess /Flags 5 /FontBBox [0 -200 500 800] ' +
    '/ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>');
  const cmap = ascii(toUnicode(used));
  object(7, `<< /Length ${cmap.length} >>`, cmap);

  pages.forEach(({ jpeg, width, height, words, imageMatrix }, i) => {
    const { w, h } = jpegSize(jpeg);
    const [pageId, contentId, imgId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    // The photo fills the page, or sits where imageMatrix puts it (under its words).
    const m = imageMatrix ?? [width, 0, 0, height, 0, 0];
    const content = ascii(`q\n${m.map(v => v.toFixed(4)).join(' ')} cm\n/Im0 Do\nQ\n` +
      textLayer(words, height));
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 ${imgId} 0 R >> /Font << /F1 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    object(contentId, `<< /Length ${content.length} >>`, content);
    object(imgId, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  });

  const xrefAt = pos;
  put(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let n = 1; n < offsets.length; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
