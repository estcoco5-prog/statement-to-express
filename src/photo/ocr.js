// Browser only. Turns a photo file into an upright picture, reads it with
// tesseract.js (loaded the first time a photo is used), and hands back the
// words in photo pixels plus the visible JPEG - turned only, no colour change.
// Nothing is stored: the reader is told not to cache, and every result lives
// only in the caller's memory.
import { readExifOrientation, orientationTransform, swapsAxes, ORIENTATION_NORMAL } from './exif.js';
import { readScale } from './quality.js';

export const OCR_PATHS = {
  script: 'vendor/tesseract/tesseract.min.js',
  workerPath: 'vendor/tesseract/worker.min.js',
  corePath: 'vendor/tesseract/core/',
  langPath: 'vendor/tesseract/lang/',
};
// Phones shoot 12+ megapixels; past this long edge reading gets slow for no
// gain (statement print stays well above the sharpness gate's 18 px).
export const MAX_EDGE = 3200;

export class PhotoError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let workerPromise = null;
function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => fail(new Error(`could not load ${src}`));
    document.head.append(s);
  });
}

// One reader for the whole page, made on first use.
function reader(onStatus) {
  workerPromise ??= (async () => {
    onStatus?.('Loading the photo reader (first time only, about 8 MB) · กำลังโหลดตัวอ่านรูป ครั้งแรกเท่านั้น');
    await loadScript(OCR_PATHS.script);
    return globalThis.Tesseract.createWorker(['tha', 'eng'], 1, {
      workerPath: OCR_PATHS.workerPath, corePath: OCR_PATHS.corePath, langPath: OCR_PATHS.langPath,
      workerBlobURL: false, gzip: true, cacheMethod: 'none',
    });
  })();
  workerPromise.catch(() => { workerPromise = null; });   // a failed load can be retried
  return workerPromise;
}

const canvasOf = (w, h) => new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
const toBytes = async blob => new Uint8Array(await blob.arrayBuffer());

// Decode without the browser applying EXIF, then apply it once. If the browser
// rotated anyway, the decoded shape comes back already swapped: stand down
// (the same guard as Pic-to-PDF, proven on Co's iPhone).
export async function decodeUpright(file) {
  const raw = new Uint8Array(await file.arrayBuffer());
  const orientation = readExifOrientation(raw);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'none' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const effective = swapsAxes(orientation) && bitmap.width < bitmap.height ? ORIENTATION_NORMAL : orientation;
  const t = orientationTransform(effective, bitmap.width, bitmap.height);
  const scale = Math.min(1, MAX_EDGE / Math.max(t.w, t.h));
  const canvas = canvasOf(t.w * scale, t.h * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);
  ctx.transform(...t.matrix);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

/**
 * @param {File} file a JPEG or PNG photo
 * @returns {Promise<{jpeg:Uint8Array, size:{w:number,h:number}, ocrWords:Array}>}
 */
export async function readPhoto(file, onStatus) {
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) throw new PhotoError('heic', 'HEIC photo');
  let canvas;
  try {
    canvas = await decodeUpright(file);
  } catch {
    throw new PhotoError('not-photo', 'this file is not a photo that can be opened');
  }
  const jpeg = await toBytes(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }));
  // Working copy for reading only: enlarged, grey and higher contrast. Never
  // shown or saved. Boxes come back in the working copy's pixels: divide by k.
  const k = readScale(canvas.width, canvas.height);
  const work = canvasOf(canvas.width * k, canvas.height * k);
  const wctx = work.getContext('2d');
  wctx.imageSmoothingQuality = 'high';
  wctx.filter = 'grayscale(1) contrast(1.6)';
  wctx.drawImage(canvas, 0, 0, work.width, work.height);
  const worker = await reader(onStatus);
  const { data } = await worker.recognize(await work.convertToBlob({ type: 'image/png' }), {}, { blocks: true });
  const ocrWords = [];
  for (const block of data.blocks ?? []) for (const para of block.paragraphs) for (const line of para.lines) {
    for (const w of line.words) {
      ocrWords.push({ text: w.text, x0: w.bbox.x0 / k, y0: w.bbox.y0 / k, x1: w.bbox.x1 / k, y1: w.bbox.y1 / k,
        conf: w.confidence });
    }
  }
  return { jpeg, size: { w: canvas.width, h: canvas.height }, ocrWords };
}

// A picture-only PDF (a scan) -> one JPEG File per page, for the photo path.
export async function picturesFromPdf(bytes, pdfjs) {
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    const files = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 200 / 72 });
      const c = canvasOf(vp.width, vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      files.push(new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], `page-${n}.jpg`,
        { type: 'image/jpeg' }));
    }
    return files;
  } finally {
    await task.destroy();
  }
}
