// Private development aid: read sample statement pages with the photo reader
// and save the words it sees, so the picture -> table step can be built and
// measured without re-reading. Output holds real data: it goes to the
// directory given (outside the repo) and must be deleted after use.
//
//   node tools/ocr-dump.mjs <samples.json> <out dir> [pages]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWorker } from 'tesseract.js';
import { readScale } from '../src/photo/quality.js';

const [samplesPath, out, pagesArg] = process.argv.slice(2);
const base = path.dirname(path.resolve(samplesPath));
const { cases } = JSON.parse(fs.readFileSync(samplesPath, 'utf8'));
const pages = Number(pagesArg ?? 1);
const poppler = execFileSync('python', ['-c', 'import triage_pdf,os;print(os.path.dirname(triage_pdf._tool("pdftotext")))'],
  { cwd: base, encoding: 'utf8' }).trim();
const PREP = `
import sys
from PIL import Image, ImageFilter, ImageDraw
src, kind, out, work = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
im = Image.open(src).convert('RGB')
if kind == 'photo':
    im = im.rotate(-1.5, expand=True, fillcolor=(90, 80, 70), resample=Image.BICUBIC)
    sh = Image.new('L', im.size, 0); dr = ImageDraw.Draw(sh)
    for x in range(im.size[0]): dr.line([(x, 0), (x, im.size[1])], fill=int(60 * x / im.size[0]))
    im = Image.composite(Image.new('RGB', im.size, (0, 0, 0)), im, sh).filter(ImageFilter.GaussianBlur(1.0))
    im = im.resize((int(im.size[0] * 0.9), int(im.size[1] * 0.9)))
if kind == 'small':
    k = 1280 / max(im.size); im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
im.save(out, quality=75 if kind == 'small' else 70 if kind == 'photo' else 90)
print(*im.size)
`;
const WORK = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('L'); k = float(sys.argv[3])
im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) if k != 1 else im
im.point(lambda v: max(0, min(255, round((v - 128) * 1.6 + 128)))).save(sys.argv[2])
`;
const worker = await createWorker(['tha', 'eng'], 1, {
  langPath: path.resolve(import.meta.dirname, '../vendor/tesseract/lang'), gzip: true, cacheMethod: 'none' });
for (const c of cases.filter(c => !c.name.startsWith('general') && c.name !== 'mixed' && !c.name.includes('duplicate')
  && (!process.env.ONLY || process.env.ONLY.split(',').includes(c.name)))) {
  const pdf = path.join(base, c.files[c.name === 'scb-batch' ? 9 : 0]);
  const pw = c.passwords?.[0];
  const prefix = path.join(out, c.name);
  execFileSync(path.join(poppler, 'pdftoppm'), [...(pw ? ['-upw', pw] : []), '-r', '200', '-jpeg', '-l', String(pages), pdf, prefix]);
  const renders = fs.readdirSync(out).filter(f => f.startsWith(`${c.name}-`) && /^[^.]*-\d+\.jpg$/.test(f)).sort();
  for (const r of renders) for (const kind of (process.env.KINDS ?? 'clean,photo,small').split(',')) {
    const img = path.join(out, r.replace('.jpg', `.${kind}.jpg`));
    const [w, h] = execFileSync('python', ['-c', PREP, path.join(out, r), kind, img, '']).toString().trim().split(' ').map(Number);
    const k = readScale(w, h);
    const copy = path.join(out, 'work.png');
    execFileSync('python', ['-c', WORK, img, copy, String(k)]);
    const { data } = await worker.recognize(copy, {}, { blocks: true });
    const words = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const x of l.words) {
      words.push({ text: x.text, x0: x.bbox.x0 / k, y0: x.bbox.y0 / k, x1: x.bbox.x1 / k, y1: x.bbox.y1 / k, conf: x.confidence });
    }
    fs.writeFileSync(img.replace(/\.jpg$/, '.json'), JSON.stringify({ case: c.name, pdf, passwords: c.passwords ?? [], kind, w, h, words }));
    console.log(c.name, r, kind, words.length, 'words');
  }
}
await worker.terminate();
