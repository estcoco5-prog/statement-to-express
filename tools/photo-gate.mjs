// The private photo gate (spec 6.3): zero silent wrong numbers.
//
//   node tools/photo-gate.mjs <samples.json> [<photos dir>]
//
// For each single-statement case in the (private) samples list: render its
// pages at 200 dpi with Poppler, make a simulated phone photo of each (tilt,
// shadow, blur, scale, JPEG - the spike's recipe, via Python PIL), read both
// through the photo pipeline into a readable PDF, run the checks, and compare
// every row the balance PROVED against the same statement read from its PDF.
// A proved row that does not match is SILENT WRONG - the one failure the gate
// forbids. With a photos dir, real photos named "<case>-*.jpg" are run too.
// Renders, photos and reader output go to %TEMP%/photo-gate and are deleted
// at the end: they hold real data. Nothing is written into the repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWorker } from 'tesseract.js';
import pdfjs from '../tests/pdfjs.js';
import { photoPage, pageSizeFor, imageMatrix } from '../src/photo/pipeline.js';
import { readScale } from '../src/photo/quality.js';
import { buildReadablePdf } from '../src/photo/pdfwrite.js';
import { readStatement, statusOf, partialRows } from '../src/engine/statement.js';

const [samplesPath, photosDir] = process.argv.slice(2);
const samples = path.resolve(samplesPath);
const base = path.dirname(samples);
const { cases } = JSON.parse(fs.readFileSync(samples, 'utf8'));
const work = path.join(os.tmpdir(), 'photo-gate');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
// Page 1 per bank keeps a run to minutes. UOB's page 1 is an account summary
// with no transaction table: it is included (Co 2026-10-07) and read as a
// summary page - period and account facts only.
const MAX_PAGES = Number(process.env.GATE_PAGES ?? 1);

const poppler = execFileSync('python', ['-c', 'import triage_pdf,os;print(os.path.dirname(triage_pdf._tool("pdftotext")))'],
  { cwd: base, encoding: 'utf8' }).trim();
// A small picture, as a chat app sends it: long edge 1280 px, JPEG quality 75
// (LINE's standard-quality setting is about this size).
const SMALL = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); k = 1280 / max(im.size)
im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS).save(sys.argv[2], quality=75)
`;
const SIMULATE = `
import sys
from PIL import Image, ImageFilter, ImageDraw
src, out = sys.argv[1], sys.argv[2]
ph = Image.open(src).convert('RGB').rotate(-1.5, expand=True, fillcolor=(90, 80, 70), resample=Image.BICUBIC)
sh = Image.new('L', ph.size, 0); dr = ImageDraw.Draw(sh)
for x in range(ph.size[0]): dr.line([(x, 0), (x, ph.size[1])], fill=int(60 * x / ph.size[0]))
ph = Image.composite(Image.new('RGB', ph.size, (0, 0, 0)), ph, sh).filter(ImageFilter.GaussianBlur(1.0))
ph.resize((int(ph.size[0] * 0.9), int(ph.size[1] * 0.9))).save(out, quality=70)
`;

const worker = await createWorker(['tha', 'eng'], 1, {
  langPath: path.resolve(import.meta.dirname, '../vendor/tesseract/lang'), gzip: true, cacheMethod: 'none' });
// The web page reads an enlarged, grey, higher-contrast working copy
// (src/photo/ocr.js: readScale, CSS grayscale(1) contrast(1.6)); the gate reads the same thing.
const WORKING_COPY = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('L'); k = float(sys.argv[3])
im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) if k != 1 else im
im.point(lambda v: max(0, min(255, round((v - 128) * 1.6 + 128)))).save(sys.argv[2])
`;
async function ocr(file) {
  const copy = path.join(work, 'working-copy.png');
  const { w, h } = jpegSize(file);
  const k = readScale(w, h);           // the same enlargement as src/photo/ocr.js
  execFileSync('python', ['-c', WORKING_COPY, file, copy, String(k)]);
  const { data } = await worker.recognize(copy, {}, { blocks: true });
  const words = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) {
    words.push({ text: w.text, x0: w.bbox.x0 / k, y0: w.bbox.y0 / k, x1: w.bbox.x1 / k, y1: w.bbox.y1 / k, conf: w.confidence });
  }
  return words;
}
const jpegSize = file => {
  const out = execFileSync('python', ['-c', 'import sys;from PIL import Image;print(*Image.open(sys.argv[1]).size)', file], { encoding: 'utf8' });
  const [w, h] = out.trim().split(' ').map(Number);
  return { w, h };
};
const key = r => `${r.date}|${r.withdrawal ?? ''}|${r.deposit ?? ''}`;

async function runPhotos(name, images, truth) {
  const pages = [];
  for (const img of images) {
    const page = photoPage(await ocr(img), jpegSize(img));
    if (!page.ok) return { verdict: `⛔ refused (${page.code}) on ${path.basename(img)}` };
    const size = pageSizeFor(page.bank);
    if (pages.length && pages[0].bank !== page.bank) return { verdict: `⛔ refused (mixed-banks) on ${path.basename(img)}` };
    pages.push({ jpeg: new Uint8Array(fs.readFileSync(img)), ...size, words: page.words, bank: page.bank, summary: !!page.summary,
      imageMatrix: imageMatrix(page.placement, jpegSize(img).w, jpegSize(img).h, size.height) });
  }
  let st;
  try {
    const summaryPages = pages.flatMap((pg, i) => pg.summary ? [i] : []);
    if (summaryPages.length === pages.length) return { verdict: '⛔ refused (summary-only)' };
    const readable = buildReadablePdf(pages, { bank: pages[0].bank, summaryPages });
    if (process.env.GATE_DUMP) fs.writeFileSync(path.join(process.env.GATE_DUMP, `${name}-${path.basename(images[0], '.jpg')}.pdf`), readable);
    st = await readStatement(`${name}.pdf`, readable, [], null, pdfjs);
  } catch (e) {
    return { verdict: `⛔ checker refused: ${e.message.slice(0, 70)}` };
  }
  const real = new Set(truth.rows.map(key));
  const proved = st.rows.filter(r => r.verified);
  const wrong = proved.filter(r => !real.has(key(r)));
  if (process.env.GATE_DEBUG) console.log(st.rows.map(r => r.date.slice(5)).join(" "));
  if (process.env.GATE_DEBUG) for (const r of st.rows.filter(r => !r.verified)) console.log('  unproved:', r.date, r.withdrawal, r.deposit, r.balance, '| truth rows same date:', truth.rows.filter(t => t.date === r.date).map(t => `${t.withdrawal ?? ''}/${t.deposit ?? ''}=${t.balance}`).join(' '));
  if (process.env.GATE_DEBUG) console.log('  truth on these dates:', truth.rows.filter(t => t.date <= st.rows[st.rows.length - 1].date).length);
  if (process.env.GATE_DEBUG) for (const r of wrong) console.log("  not in PDF:", key(r), "| nearest:", truth.rows.filter(t => t.balance === r.balance).map(key));
  const status = statusOf(st);
  // Silent = a wrong row that still reaches Express. A red statement from
  // photos may send its PROVED rows (decision B, partialRows): every one of
  // them must match the PDF; the rest of a red statement never reaches Express.
  const partial = status === 'red' ? partialRows(st) : null;
  const partialWrong = (partial ?? []).filter(r => !real.has(key(r)));
  const silentWrong = status === 'red' ? partialWrong.length : wrong.length;
  const tag = silentWrong ? '❌ SILENT WRONG' : partial ? `🟠 partial ${partial.length} rows to Express` : status === 'red' ? '🔴 caught' : '🟡 correct';
  const failed = st.checks.filter(([, ok]) => !ok).map(([label]) => label);
  return { verdict: `${tag} - ${status}, ${st.rows.length} rows read, ${proved.length} proved, ${truth.rows.length} in the PDF` +
    (wrong.length ? `; ${wrong.length} proved row(s) differ from the PDF` : '') +
    (failed.length ? `\n${' '.repeat(32)}failed: ${failed.join(' / ')}` : ''), silentWrong };
}

let silent = 0;
for (const c of cases.filter(c => (!process.env.GATE_ONLY || c.name === process.env.GATE_ONLY) && !c.name.startsWith('general') && c.files.length >= 1 && c.name !== 'mixed'
  && !c.name.includes('duplicate'))) {
  const pdf = path.join(base, c.files[c.name === 'scb-batch' ? 9 : 0]);
  const truth = await readStatement('truth.pdf', new Uint8Array(fs.readFileSync(pdf)), c.passwords ?? [], null, pdfjs);
  const pw = c.passwords?.[0];
  const prefix = path.join(work, c.name);
  execFileSync(path.join(poppler, 'pdftoppm'), [...(pw ? ['-upw', pw] : []), '-r', '200', '-jpeg',
    '-l', String(MAX_PAGES), pdf, prefix]);
  const clean = fs.readdirSync(work).filter(f => f.startsWith(`${c.name}-`) && f.endsWith('.jpg') && !f.includes('photo'))
    .sort().map(f => path.join(work, f));
  const photos = clean.map(f => {
    const out = f.replace(/\.jpg$/, '-photo.jpg');
    execFileSync('python', ['-c', SIMULATE, f, out]);
    return out;
  });
  const smalls = clean.map(f => {
    const out = f.replace(/\.jpg$/, '-photo-small.jpg');
    execFileSync('python', ['-c', SMALL, f, out]);
    return out;
  });
  const partial = clean.length < (await (await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), password: pw }).promise).numPages);
  const kinds = [['clean render', clean], ['simulated photo', photos], ['small picture', smalls]]
    .filter(([kind]) => !process.env.GATE_KINDS || process.env.GATE_KINDS.split(',').includes(kind.split(' ')[0]));
  for (const [kind, imgs] of kinds) {
    const r = await runPhotos(c.name, imgs, truth);
    silent += r.silentWrong ?? 0;
    console.log(`${c.name.padEnd(14)} ${kind.padEnd(16)} ${r.verdict}${partial ? ` (first ${MAX_PAGES} pages only)` : ''}`);
  }
  if (photosDir) {
    const real = fs.readdirSync(photosDir).filter(f => f.startsWith(`${c.name}-`) && /\.jpe?g$/i.test(f)).sort()
      .map(f => path.join(photosDir, f));
    if (real.length) {
      const r = await runPhotos(c.name, real, truth);
      silent += r.silentWrong ?? 0;
      console.log(`${c.name.padEnd(14)} ${'REAL PHOTOS'.padEnd(16)} ${r.verdict}`);
    }
  }
}
await worker.terminate();
fs.rmSync(work, { recursive: true, force: true });
console.log(silent ? `\nGATE FAILED: ${silent} silent wrong row(s)` : '\nGATE PASSED: zero silent wrong numbers');
process.exit(silent ? 1 : 0);
