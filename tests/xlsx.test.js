import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { crc32, zipStore } from '../src/engine/output/zip.js';
import { Sheet, Cell, money, colLetter, workbookParts, writeXlsx, HEADER, MONEY } from '../src/engine/output/xlsx.js';

// Minimal reader for the zip we write: name -> text, via the central directory.
export function unzip(bytes) {
  const buf = Buffer.from(bytes);
  const out = {};
  let i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(i + 10);
  let p = buf.readUInt32LE(i + 16);
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lname = buf.readUInt16LE(local + 26), lextra = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lname + lextra, local + 30 + lname + lextra + csize);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

test('crc32 of "hello"', () => assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686));

test('column letters', () => assert.deepEqual([0, 25, 26, 27, 701, 702].map(colLetter), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']));

test('cells are written exactly like the answer key', () => {
  const s = new Sheet('T', { widths: [10, 12.5], freezeRows: 1 });
  s.add(new Cell('a & <b> "q"', HEADER), money(750000), new Cell(46182), new Cell(''), 'plain', new Cell(null));
  const xml = workbookParts([s]).find(p => p.name === 'xl/worksheets/sheet1.xml').text;
  assert.ok(xml.includes('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">a &amp; &lt;b&gt; "q"</t></is></c>'), xml);
  assert.ok(xml.includes(`<c r="B1" s="${MONEY}"><v>7500.0</v></c>`));
  assert.ok(xml.includes('<c r="C1" s="0"><v>46182</v></c>'));
  assert.ok(xml.includes('<c r="D1" s="0"/>'));
  assert.ok(xml.includes('<c r="E1" s="0" t="inlineStr"><is><t xml:space="preserve">plain</t></is></c>'));
  assert.ok(xml.includes('<c r="F1" s="0"/>'));
  assert.ok(xml.includes('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'));
  assert.ok(xml.includes('<cols><col min="1" max="1" width="10" customWidth="1"/><col min="2" max="2" width="12.5" customWidth="1"/></cols>'));
});

test('sheet names lose characters Excel rejects and stop at 31', () => {
  assert.equal(new Sheet('a[b]c:d*e?f/g\\h').name, 'a-b-c-d-e-f-g-h');
  assert.equal(new Sheet('x'.repeat(40)).name.length, 31);
});

test('a table sheet gets its table part and relationship', () => {
  const s = new Sheet('BKTRN', { table: ['Table1', 1] });
  s.add('DOCNUM', 'AMOUNT'); s.add('', money(100));
  const parts = Object.fromEntries(workbookParts([s, new Sheet('Proof')]).map(p => [p.name, p.text]));
  assert.ok(parts['xl/tables/table1.xml'].includes('ref="A1:B2"'));
  assert.ok(parts['xl/tables/table1.xml'].includes('<tableColumn id="1" name="DOCNUM"/><tableColumn id="2" name="AMOUNT"/>'));
  assert.ok(parts['xl/worksheets/_rels/sheet1.xml.rels'].includes('Target="../tables/table1.xml"'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].endsWith('<tableParts count="1"><tablePart r:id="rIdTable"/></tableParts></worksheet>'));
  assert.ok(parts['[Content_Types].xml'].includes('/xl/tables/table1.xml'));
  assert.ok(parts['xl/workbook.xml'].includes('<sheet name="BKTRN" sheetId="1" r:id="rId1"/><sheet name="Proof" sheetId="2" r:id="rId2"/>'));
});

test('the zip is readable, holds every part, and is deterministic', () => {
  const s = new Sheet('T');
  s.add('ไทย');
  const bytes = writeXlsx([s]);
  const parts = unzip(bytes);
  assert.deepEqual(Object.keys(parts).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
    'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort());
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('ไทย'));
  assert.deepEqual(writeXlsx([s]), bytes);
});

test('a workbook needs at least one sheet', () => assert.throws(() => writeXlsx([])));

test('zipStore stores names in UTF-8', () => {
  const parts = unzip(zipStore([{ name: 'ก.txt', data: 'x' }]));
  assert.deepEqual(parts, { 'ก.txt': 'x' });
});

test('cells the team must fill are yellow and formatted as text', async () => {
  const { workbookParts: parts, Sheet: S, Cell: C, TODO: T } = await import('../src/engine/output/xlsx.js');
  const sh = new S('x'); sh.add(new C('', T));
  const styles = parts([sh]).find(p => p.name === 'xl/styles.xml').text;
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)[1].trim().split('\n');
  assert.match(xfs[T], /numFmtId="49".*fillId="3"/);
});
