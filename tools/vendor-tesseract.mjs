// Copy the photo reader (tesseract.js + its engine + Thai/English language
// files) into vendor/tesseract/, so the page loads nothing from another site.
// Prints each file's size - the one-time download a user pays on first
// photo use.   npm run vendor:ocr
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'vendor', 'tesseract');
let total = 0;
const copy = (from, to) => {
  const dest = path.join(out, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, 'node_modules', from), dest);
  const size = fs.statSync(dest).size;
  total += size;
  console.log(String(size).padStart(10), to);
};
copy('tesseract.js/dist/tesseract.min.js', 'tesseract.min.js');
copy('tesseract.js/dist/worker.min.js', 'worker.min.js');
// The reader runs in LSTM-only mode, which loads one of these two (with or
// without SIMD, chosen by the browser). The .wasm.js files carry the engine
// inside them, so no separate .wasm fetch is needed.
copy('tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js');
copy('tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js');
copy('@tesseract.js-data/tha/4.0.0_best_int/tha.traineddata.gz', 'lang/tha.traineddata.gz');
copy('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz');
console.log(String(total).padStart(10), 'TOTAL');
