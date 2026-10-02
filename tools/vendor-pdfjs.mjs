// Copy pdf.js from node_modules into vendor/pdfjs and apply our ONE patch.
//
//   node tools/vendor-pdfjs.mjs
//
// The patch: pdf.js reads a marked-content span's properties but passes on only
// its MCID. Statements like UOB's store the real letters of a font whose own
// letter map is blank in each span's /ActualText - Poppler, the answer key,
// reads them. The patch adds `actualText` (the raw PDF string, or null) to the
// beginMarkedContentProps item that getTextContent({ includeMarkedContent })
// already emits. Nothing else changes. It fails loudly if pdf.js changed shape.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules', 'pdfjs-dist');
const to = path.join(root, 'vendor', 'pdfjs');

export function patchWorker(src) {
  // ...type:"beginMarkedContentProps",id:<...>,tag:k[0]instanceof Name?k[0].name:null}
  const re = /(type:"beginMarkedContentProps",id:.{0,120}?,tag:(\w+)\[0\]instanceof Name\?\2\[0\]\.name:null)\}/g;
  const hits = [...src.matchAll(re)];
  if (hits.length !== 1) throw new Error(`expected exactly 1 patch site, found ${hits.length}`);
  return src.replace(re, (_, head, k) =>
    `${head},actualText:${k}[1]instanceof Dict&&"string"==typeof ${k}[1].get("ActualText")?${k}[1].get("ActualText"):null}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(from, 'build', 'pdf.min.mjs'), path.join(to, 'pdf.min.mjs'));
  fs.copyFileSync(path.join(from, 'LICENSE'), path.join(to, 'LICENSE'));
  const worker = fs.readFileSync(path.join(from, 'build', 'pdf.worker.min.mjs'), 'utf8');
  fs.writeFileSync(path.join(to, 'pdf.worker.min.mjs'), patchWorker(worker));
  const { version } = JSON.parse(fs.readFileSync(path.join(from, 'package.json'), 'utf8'));
  console.log(`vendored pdf.js ${version} into vendor/pdfjs, ActualText patch applied`);
}
