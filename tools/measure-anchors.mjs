// Print candidate header words (anchors for the photo reader) from real PDFs.
//   node tools/measure-anchors.mjs <samples.json>
// Private input, read from outside the repo. Prints only words above the first
// transaction, in the 45-pt band above it, that appear once on page 1 - bank furniture, never transactions.
// Pick 3-5 COLUMN HEADINGS spread left to right; never a name, address or number.
import fs from 'node:fs';
import path from 'node:path';
import pdfjs from '../tests/pdfjs.js';
import { readWords } from '../src/engine/words.js';
import { groupIntoRows, DATE_RE } from '../src/engine/rows.js';
import { identify } from '../src/engine/profiles.js';

const samples = path.resolve(process.argv[2]);
const { cases } = JSON.parse(fs.readFileSync(samples, 'utf8'));
for (const c of cases.filter(c => !c.name.startsWith('general') && !c.name.includes('duplicate') && c.name !== 'mixed')) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(path.dirname(samples), c.files[0])));
  const pages = await readWords(bytes, c.passwords?.[0] ?? null, pdfjs);
  // The first transaction: a row with a date AND an amount, on whichever page
  // has one (UOB opens with a summary page). The headings sit just above it.
  const MONEY = /^-?[\d,]+\.\d{2}$/;
  const isTx = r => r.some(w => DATE_RE.test(w.text) || /^\d{1,2} [A-Z][a-z]{2}$/.test(w.text))
    && r.some(w => MONEY.test(w.text));
  let rows = [], first = -1;
  for (const page of pages) {
    rows = groupIntoRows(page);
    first = rows.findIndex(isTx);
    if (first >= 0) break;
  }
  const top = first < 0 ? Infinity : Math.min(...rows[first].map(w => w.y0));
  const header = rows.slice(0, first < 0 ? rows.length : first).flat().filter(w => w.y0 > top - 45);
  const once = header.filter(w => header.filter(o => o.text === w.text).length === 1
    && w.text.length >= 4 && !/\d{3}/.test(w.text));
  const bank = identify(rows.flat().map(w => w.text).join(' '))?.key ?? c.name;
  console.log(`\n== ${bank}`);
  for (const w of once) console.log(`  ${JSON.stringify({ text: w.text, x0: +w.x0.toFixed(1), y0: +w.y0.toFixed(1) })}`);
}
