import { test } from 'node:test';
import assert from 'node:assert/strict';
import pdfjs from '../pdfjs.js';
import { readWords, Word } from '../../src/engine/words.js';
import { buildReadablePdf, TOOL_A_PRODUCER } from '../../src/photo/pdfwrite.js';
import { TINY_JPEG } from './tinyjpeg.js';

const words = [new Word(40, 200, 85, 210, 'ยอดยกมา'), new Word(480, 200, 520, 210, '1,000.00'),
               new Word(40, 230, 76, 240, '01/06/26'), new Word(300, 230, 330, 240, '250.00'),
               new Word(123, 230, 160, 240, 'ดอกเบี้ย')];   // tone marks: zero-width in real fonts

test('words written into the readable PDF come back in the same place', async () => {
  const pdf = buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words }]);
  const [page] = await readWords(pdf, null, pdfjs);
  assert.deepEqual(page.map(w => w.text), words.map(w => w.text));
  page.forEach((w, i) => {
    assert.ok(Math.abs(w.x0 - words[i].x0) < 1 && Math.abs(w.x1 - words[i].x1) < 1, `${w.text} x ${w.x0}-${w.x1}`);
    assert.ok(Math.abs((w.y0 + w.y1) / 2 - (words[i].y0 + words[i].y1) / 2) < 2, `${w.text} y ${w.y0}-${w.y1}`);
  });
});

test('the PDF says it was made from a photo', async () => {
  const pdf = buildReadablePdf([{ jpeg: TINY_JPEG, width: 595, height: 842, words }]);
  const task = pdfjs.getDocument({ data: pdf });
  const doc = await task.promise;
  assert.equal((await doc.getMetadata()).info.Producer, TOOL_A_PRODUCER);
  await task.destroy();
});
