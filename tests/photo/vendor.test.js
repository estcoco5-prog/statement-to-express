import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const need = ['tesseract.min.js', 'worker.min.js', 'lang/tha.traineddata.gz', 'lang/eng.traineddata.gz'];

test('the photo reader is vendored, nothing loads from another site', () => {
  for (const f of need) assert.ok(fs.existsSync(new URL(`../../vendor/tesseract/${f}`, import.meta.url)), f);
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.equal(csp, "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; " +
    "style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; " +
    "base-uri 'none'; form-action 'none'");
  assert.doesNotMatch(html, /https?:\/\/(?!estcoco5-prog\.github\.io\/Pic-to-PDF)/);
});
