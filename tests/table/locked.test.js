// Password-locked files (Co 2026-10-16): the Picture, Passbook and Excel cards
// do not unlock them - the team does not send locked files - but each says
// the file is locked, instead of "not a PDF" or "could not be opened".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pdfjs from '../pdfjs.js';
import { miniPdf } from '../minipdf.js';
import { picturesFromPdf } from '../../src/photo/ocr.js';
import { readTableFile, isLockedExcel } from '../../src/table/read.js';
import { miniXls } from './minixls.js';

const LINES = [[50, 60, 'made-up scan page']];

test('a locked scanned PDF is refused as locked on the picture cards', async () => {
  await assert.rejects(picturesFromPdf(miniPdf(LINES, { password: 'testpw' }), pdfjs), { code: 'locked-pdf' });
  // not every failure is called locked
  await assert.rejects(picturesFromPdf(new TextEncoder().encode('not a pdf at all'), pdfjs),
    e => e.code !== 'locked-pdf');
});

// A locked .xlsx is a compound file with an EncryptionInfo stream; its name
// sits in the directory in UTF-16. Only that part matters here.
function lockedXlsx() {
  const b = new Uint8Array(1536);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  [...'EncryptionInfo'].forEach((ch, i) => { b[1024 + 2 * i] = ch.charCodeAt(0); });
  return b;
}

test('a locked Excel file is refused as locked, by any name', async () => {
  for (const name of ['statement.xlsx', 'statement.xls']) {
    await assert.rejects(readTableFile(name, lockedXlsx()), { code: 'locked-excel' }, name);
  }
  // an ordinary old .xls is a compound file too, and is still read
  const xls = miniXls([['Date', 'Balance'], ['01/01/2025', '100.00']]);
  assert.equal(isLockedExcel(xls), false);
  assert.ok((await readTableFile('ok.xls', xls)).length);
});
