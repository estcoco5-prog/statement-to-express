// Copied from Pic-to-PDF js/exif.js on 2026-10-02 (orientation only), unchanged below.
/**
 * exif.js - the sideways-photo problem. Pure maths, no browser.
 *
 * A phone held sideways does NOT save a rotated photo. It saves the same
 * upright pixels plus a note ("orientation") saying how to turn them. Browsers
 * disagree about whether they apply that note for you, so we read it ourselves
 * and rotate exactly once, deliberately.
 */

export const ORIENTATION_NORMAL = 1;

/** Orientations 5-8 turn the image on its side, so width and height swap. */
export const swapsAxes = (o) => o >= 5 && o <= 8;

/**
 * Read the orientation tag out of a JPEG's EXIF block.
 * Returns 1 (normal) whenever there is no tag or anything looks wrong - a photo
 * that shows up straight is a far better failure than one that throws.
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {number} 1-8
 */
export function readExifOrientation(input) {
  const d = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (d.length < 4 || d[0] !== 0xff || d[1] !== 0xd8) return ORIENTATION_NORMAL;

  let i = 2;
  while (i + 3 < d.length) {
    if (d[i] !== 0xff) return ORIENTATION_NORMAL;
    const marker = d[i + 1];
    if (marker === 0xda || marker === 0xd9) return ORIENTATION_NORMAL; // image data starts
    const len = (d[i + 2] << 8) | d[i + 3];
    if (len < 2) return ORIENTATION_NORMAL;

    if (marker === 0xe1) {                       // APP1 - where EXIF lives
      const seg = i + 4;
      const isExif = d[seg] === 0x45 && d[seg + 1] === 0x78
                  && d[seg + 2] === 0x69 && d[seg + 3] === 0x66;
      if (isExif) {
        const found = scanTiff(d, seg + 6, i + 2 + len);
        if (found) return found;
      }
    }
    i += 2 + len;
  }
  return ORIENTATION_NORMAL;
}

/** Walk the TIFF header inside EXIF looking for tag 0x0112 (orientation). */
function scanTiff(d, tiff, end) {
  if (tiff + 8 > d.length) return null;
  const le = d[tiff] === 0x49 && d[tiff + 1] === 0x49;      // "II" little-endian
  const be = d[tiff] === 0x4d && d[tiff + 1] === 0x4d;      // "MM" big-endian
  if (!le && !be) return null;

  const u16 = (at) => (le ? d[at] | (d[at + 1] << 8) : (d[at] << 8) | d[at + 1]);
  const u32 = (at) => (le
    ? (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0
    : ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0);

  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > d.length || ifd + 2 > end) return null;

  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > d.length || entry + 12 > end) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);              // SHORT, stored in the value slot
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * How to draw an image so the orientation note is honoured exactly once.
 * @param {number} o orientation 1-8
 * @param {number} w stored pixel width
 * @param {number} h stored pixel height
 * @returns {{w:number, h:number, matrix:number[]}} canvas size, and the
 *          [a,b,c,d,e,f] matrix to hand to setTransform before drawing at 0,0.
 */
export function orientationTransform(o, w, h) {
  switch (o) {
    case 2: return { w,    h,    matrix: [-1, 0, 0, 1, w, 0] };  // mirror
    case 3: return { w,    h,    matrix: [-1, 0, 0, -1, w, h] }; // 180
    case 4: return { w,    h,    matrix: [1, 0, 0, -1, 0, h] };  // mirror vertical
    case 5: return { w: h, h: w, matrix: [0, 1, 1, 0, 0, 0] };   // transpose
    case 6: return { w: h, h: w, matrix: [0, 1, -1, 0, h, 0] };  // 90 clockwise
    case 7: return { w: h, h: w, matrix: [0, -1, -1, 0, h, w] }; // transverse
    case 8: return { w: h, h: w, matrix: [0, -1, 1, 0, 0, w] };  // 90 anticlockwise
    default: return { w, h, matrix: [1, 0, 0, 1, 0, 0] };        // 1, or anything odd
  }
}
