// Excel -> Express: spreadsheets someone else made from pictures, proved here
// by the balance chain. Every figure is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCsv, readXlsx } from '../../src/table/read.js';
import { findColumns, moneyCell, dateCell, tableLines } from '../../src/table/columns.js';
import { tableStatement } from '../../src/table/statement.js';
import { partialRows, rowsToCheck, statusOf } from '../../src/engine/statement.js';
import { groupBatch } from '../../src/engine/batch.js';
import { expressFiles } from '../../src/engine/output/express.js';
import { writeXlsx, Sheet, Cell } from '../../src/engine/output/xlsx.js';

const CSV = `Statement of account
วันที่,รายการ,ถอน,ฝาก,คงเหลือ
,ยอดยกมา,,,"1,000.00"
15/01/2568,โอนเงินเข้า,,250.00,"1,250.00"
16/01/2568,ชำระบิล,"1,200.50",,49.50
,ค่าไฟฟ้า งวด 1,,,
17/02/2568,เงินเดือน,,"12,345.67","12,395.17"
18/02/2568,ถอนเงินสด,80.00,,"12,315.17"
`;

test('a CSV: headings found in Thai, the brought-forward row opens the account', () => {
  const [sheet] = readCsv(CSV);
  const { header, map } = findColumns(sheet.rows);
  assert.equal(header, 1);
  assert.deepEqual(map, { date: 0, description: 1, withdrawal: 2, deposit: 3, balance: 4 });
  const { lines, opening } = tableLines(sheet.rows, map, { header });
  assert.equal(opening, 100000);
  assert.equal(lines.length, 4);
  assert.equal(lines[1].description, 'ชำระบิล ค่าไฟฟ้า งวด 1');    // the running-on line joined
  assert.equal(lines[0].date, '2025-01-15');
});

test('proved lines go to Express; with the closing balance typed in, the last one too', () => {
  const [sheet] = readCsv(CSV);
  const { map } = findColumns(sheet.rows);
  const s = tableStatement('page1.csv', [{ name: 'page1.csv', rows: sheet.rows }], map,
    { account: '1112223334', closingText: '12,315.17', openingText: '1,000.00' });
  assert.equal(statusOf(s), 'yellow');
  assert.equal(groupBatch([s])[0].expressRows().length, 4);
  // with neither typed in, nothing tells a reading with every sign lost apart
  // from the truth: nothing goes (G8 re-review)
  const without = tableStatement('page1.csv', [{ name: 'page1.csv', rows: sheet.rows }], map);
  assert.equal(partialRows(without), null);
  // an opening typed that disagrees with the one read: the reading is in doubt, nothing goes
  const wrong = tableStatement('page1.csv', [{ name: 'page1.csv', rows: sheet.rows }], map, { closingText: '12,315.17', openingText: '1,500.00' });
  assert.equal(partialRows(wrong), null);
});

test('a number misread in a cell never reaches Express, and is listed with where it is', () => {
  const [sheet] = readCsv(CSV.replace('"12,345.67","12,395.17"', '"12,845.67","12,895.17"'));
  const { map } = findColumns(sheet.rows);
  const s = tableStatement('page1.csv', [{ name: 'page1.csv', rows: sheet.rows }], map, { openingText: '1,000.00', closingText: '12,315.17' });
  const sent = groupBatch([s])[0].expressRows().map(r => r.line);
  assert.ok(sent.includes(4) && sent.includes(5), 'the lines before the misread, linked to the typed opening, still go');
  assert.ok(!sent.includes(7) && !sent.includes(8));
  assert.ok(rowsToCheck(s).some(r => r.line === 7));
  const [out] = expressFiles(groupBatch([s]));
  assert.ok(out.sheets.some(sh => sh.name === 'Rows to check'));
});

test('two files, one per page: the second page must carry on from the first', () => {
  const page2 = 'Date,Description,Debit,Credit,Balance\n19/02/2025,Fee,5.00,,"12,310.17"\n20/02/2025,Interest,,1.00,"12,311.17"\n';
  const a = readCsv(CSV)[0], b = readCsv(page2)[0];
  const map = findColumns(a.rows).map;
  const s = tableStatement('x', [{ name: 'p1.csv', rows: a.rows }, { name: 'p2.csv', rows: b.rows }], map, { closingText: '12,311.17', openingText: '1000' });
  assert.equal(s.rows.length, 6);
  assert.equal(statusOf(s), 'yellow');
  const gap = tableStatement('x', [{ name: 'p1.csv', rows: a.rows }, { name: 'p2.csv', rows: b.rows.slice(0, 1).concat(b.rows.slice(2)) }], map, { closingText: '12,311.17' });
  assert.equal(gap.checks.find(([l]) => l.startsWith('Each page'))[1], false);
});

test('Thai headings with more words still name their column', () => {
  const { map } = findColumns([['วันที่ทำรายการ', 'รายละเอียด', 'ถอนเงิน', 'ฝากเงิน', 'ยอดคงเหลือ'], ['Date', 'Desc', 'DR', 'Cr.', 'Bal.']]);
  assert.deepEqual(map, { date: 0, description: 1, withdrawal: 2, deposit: 3, balance: 4 });
  assert.deepEqual(findColumns([['Date', 'Particulars', 'Dr', 'Cr', 'Balance']]).map, { date: 0, description: 1, withdrawal: 2, deposit: 3, balance: 4 });
});

test('money and dates the way spreadsheets write them', () => {
  assert.deepEqual(moneyCell('(1,234.50)'), { cents: 123450, sign: '-' });
  assert.deepEqual(moneyCell('1,234.50-'), { cents: 123450, sign: '-' });
  assert.deepEqual(moneyCell('฿ 99 Cr'), { cents: 9900, sign: '+' });
  assert.equal(moneyCell(-5.5).cents, 550);
  assert.ok(moneyCell('12,34.5x').bad);
  assert.equal(dateCell(45658).iso, '2025-01-01');                 // an Excel day number
  assert.equal(dateCell('25/05/68').iso, '2025-05-25');            // 2-digit Buddhist year
  assert.equal(dateCell('25/05/25').iso, '2025-05-25');            // 2-digit Western year
  assert.equal(dateCell('25 พ.ค. 2568').iso, '2025-05-25');
  assert.equal(dateCell('3 Feb 2025').iso, '2025-02-03');
  assert.match(dateCell('05/25/2025').note, /month-first/);
  assert.equal(dateCell('31/02/2025').iso, null);
});

test('an .xlsx written by Excel is read back cell for cell', async () => {
  const sh = new Sheet('Page 1');
  sh.add('วันที่', 'รายการ', 'ถอน', 'ฝาก', 'คงเหลือ');
  sh.add(new Cell(45658, 0, 'float'), 'โอน & "ทดสอบ"', '', new Cell(250, 0, 'float'), new Cell(1250, 0, 'float'));
  const [sheet] = await readXlsx(writeXlsx([sh]));
  assert.equal(sheet.name, 'Page 1');
  assert.deepEqual(sheet.rows[0], ['วันที่', 'รายการ', 'ถอน', 'ฝาก', 'คงเหลือ']);
  assert.equal(sheet.rows[1][0], 45658);
  assert.equal(sheet.rows[1][1], 'โอน & "ทดสอบ"');
  assert.equal(sheet.rows[1][4], 1250);
});

// Excel itself compresses the parts of an .xlsx (method 8); build one like it.
import zlib from 'node:zlib';
import { crc32 } from '../../src/engine/output/zip.js';
function deflatedZip(files) {
  const enc = new TextEncoder(), local = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text), data = zlib.deflateRawSync(raw), n = enc.encode(name), crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    local.push(h, n, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, cd, e]));
}

test('a compressed .xlsx with shared strings (as Excel and converters save it)', async () => {
  const bytes = deflatedZip({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Date</t></si><si><t>Balance</t></si><si><r><t>ค่า</t></r><r><t>ไฟ</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1250.5</v></c></row></sheetData></worksheet>',
  });
  const [sheet] = await readXlsx(bytes);
  assert.deepEqual(sheet.rows, [['Date', '', 'Balance'], ['ค่าไฟ', '', 1250.5]]);
});

// G8 Excel review probes (truth in each comment). None may put a wrong figure in Express.
const sheetOf = csv => readCsv(csv)[0].rows;
const MAP = { date: 0, description: 1, amount: 2, balance: 3 };
const one = (csv, opts) => tableStatement('x.csv', [{ name: 'x.csv', rows: sheetOf(csv) }], MAP, opts);

test('probe B1: a typed overdraft keeps its minus sign', () => {
  // truth: overdrawn -1,000.00, then deposits: -900, -800, -750 - the converter lost the minus signs
  const lost = 'Date,Description,Amount,Balance\n,ยอดยกมา,,1000.00\n15/01/2568,x,100.00,900.00\n16/01/2568,y,100.00,800.00\n17/01/2568,z,50.00,750.00\n';
  const s = one(lost, { openingText: '-1,000.00', closingText: '-750.00' });
  assert.equal(partialRows(s), null, 'nothing goes as a withdrawal');
  assert.notEqual(statusOf(s), 'yellow');
  // read right (balances negative): the typed figures now confirm it
  const right = 'Date,Description,Amount,Balance\n,ยอดยกมา,,-1000.00\n15/01/2568,x,100.00,-900.00\n16/01/2568,y,100.00,-800.00\n17/01/2568,z,50.00,-750.00\n';
  const ok = one(right, { openingText: '-1,000.00', closingText: '-750.00' });
  assert.equal(statusOf(ok), 'yellow');
  assert.equal(ok.rows[0].deposit, 10000);
});

test('probe B2: overlapping pictures never send the same rows twice', () => {
  // truth: t0..t7 then t8, all on 05/01; file 2 starts again at t3
  const row = (k, bal) => `17/01/2568,t${k},10.00,${bal}.00`;
  const f1 = ['Date,Description,Amount,Balance', ',ยอดยกมา,,100.00', ...[0, 1, 2, 3, 4, 5, 6, 7].map(k => row(k, 110 + 10 * k))].join('\n');
  const f2 = ['Date,Description,Amount,Balance', ...[3, 4, 5, 6, 7, 8].map(k => row(k, 110 + 10 * k))].join('\n');
  const s = tableStatement('x', [{ name: 'a', rows: sheetOf(f1) }, { name: 'b', rows: sheetOf(f2) }], MAP,
    { openingText: '100.00', closingText: '190.00' });
  const sent = (partialRows(s) ?? []).map(r => r.description);
  assert.equal(new Set(sent).size, sent.length, `sent twice: ${sent}`);
  assert.ok(!(partialRows(s) ?? []).some(r => r.page === 2), 'nothing from the file that does not carry on');
  const [out] = expressFiles(groupBatch([s]));
  const check = out.sheets.find(sh => sh.name === 'Rows to check');
  assert.ok(check, 'the held file is listed on the Rows to check sheet');
});

test('probe S1: an unreadable first date is a line to check, not the opening', () => {
  const s = one('Date,Description,Amount,Balance\nO1/0l/2568,a,,1100.00\n15/01/2568,b,10.00,1110.00\n16/01/2568,c,10.00,1120.00\n');
  assert.ok(rowsToCheck(s).some(r => r.description === 'a'), 'transaction a is listed');
});

test('probe S2: a brought-forward line on a later page links the pages', () => {
  const f1 = 'Date,Description,Amount,Balance\n,ยอดยกมา,,1000.00\n15/01/2568,a,10.00,1010.00\n16/01/2568,b,10.00,1020.00\n';
  const f2 = 'Date,Description,Amount,Balance\n,ยอดยกมา,,1020.00\n17/01/2568,c,10.00,1030.00\n18/01/2568,d,10.00,1040.00\n';
  const s = tableStatement('x', [{ name: 'a', rows: sheetOf(f1) }, { name: 'b', rows: sheetOf(f2) }], MAP,
    { openingText: '1,000.00', closingText: '1,040.00' });
  assert.ok(s.checks.some(([label, ok]) => label.startsWith('Each page carries on') && ok));
  assert.equal(statusOf(s), 'yellow');
});

test('probe S3, S5, S6: an unlikely year is listed; a TOTAL payee is kept; a bad typed balance is refused', () => {
  assert.match(dateCell(25000).note, /unlikely year/);          // 1968
  const s = one('Date,Description,Amount,Balance\n,ยอดยกมา,,1000.00\n15/01/2568,TOTAL ACCESS COMM,10.00,990.00\n16/01/2568,b,10.00,980.00\n',
    { openingText: '1,000.00', closingText: '980.00' });
  assert.equal(s.rows[0].description, 'TOTAL ACCESS COMM');
  assert.throws(() => one('Date,Description,Amount,Balance\n15/01/2568,a,10.00,990.00\n', { openingText: '1.000,00' }), { code: 'bad-typed' });
});

test('a hostile file is refused, not left to freeze the page', async () => {
  const { zipStore } = await import('../../src/engine/output/zip.js');
  const part = (name, text) => ({ name, data: new TextEncoder().encode(text) });
  const xlsx = sheetXml => zipStore([
    part('xl/workbook.xml', '<workbook><sheets><sheet name="s" r:id="r1"/></sheets></workbook>'),
    part('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'),
    part('xl/worksheets/sheet1.xml', sheetXml)]);
  await assert.rejects(readXlsx(xlsx('<sheetData><row r="1"><c r="ZZZZZ1"><v>1</v></c></row></sheetData>')), { code: 'too-big' });
  // unclosed rows are read in one pass
  const t = Date.now();
  const rows = await readXlsx(xlsx('<sheetData>' + '<row><c r="A1"><v>1</v></c>'.repeat(19000) + '</sheetData>'));
  assert.equal(rows[0].rows.length, 19000);
  assert.ok(Date.now() - t < 2000);
  assert.throws(() => readCsv('a\n'.repeat(20001)), { code: 'too-big' });
  assert.throws(() => readCsv(`${'x,'.repeat(300)}\n`), { code: 'too-big' });
});

test('money and dates: spaces inside numbers, extra decimals, Thai months', () => {
  assert.ok(moneyCell('1 2 3 4.50').bad);
  assert.ok(moneyCell(12.345).bad);
  assert.equal(moneyCell('฿ 1,234.50').cents, 123450);
  assert.equal(dateCell('5 มี.ค. 68').iso, '2025-03-05');
  assert.equal(dateCell('5 เม.ย. 2568').iso, '2025-04-05');
});

// G8 re-review probes.
test('re-review 1: the page script parses (a syntax slip kills every card)', async () => {
  const { execFileSync } = await import('node:child_process');
  for (const f of ['src/app.js', 'src/view.js', 'service-worker.js']) execFileSync(process.execPath, ['--check', f]);
});

test('re-review 3: overlapping pictures with a shifted date still never send a row twice', () => {
  // truth: r0..r7 then r8; file 2 repeats r5..r7 and reads r5 one day later
  const amt = [500, -500, 200, -100, 300, 500, -500, 100, 50];
  let bal = 1000;
  const rows = amt.map((a, k) => { bal += a; return { k, a, bal, day: 15 + k }; });
  const line = r => `${String(r.day).padStart(2, '0')}/01/2568,r${r.k},${a2(r.a)},${r.bal}.00`;
  const a2 = a => `${a < 0 ? '-' : ''}${Math.abs(a)}.00`;
  const f1 = ['Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00', ...rows.slice(0, 8).map(line)].join('\n');
  const f2 = ['Date,Description,Amount,Balance', line({ ...rows[5], day: rows[5].day + 1 }), ...rows.slice(6).map(line)].join('\n');
  const s = tableStatement('x', [{ name: 'a', rows: sheetOf(f1) }, { name: 'b', rows: sheetOf(f2) }], MAP,
    { openingText: '1,000.00', closingText: `${bal}.00` });
  const sent = (partialRows(s) ?? []).map(r => r.description);
  assert.equal(new Set(sent).size, sent.length, `sent twice: ${sent}`);
  assert.ok(s.checks.some(([label, ok]) => label === 'No rows repeated from an earlier file' && !ok));
  assert.ok(!(partialRows(s) ?? []).some(r => r.page === 2));
  const [out] = expressFiles(groupBatch([s]));
  assert.ok(out.sheets.some(sh => sh.name === 'Rows to check'));
});

test('re-review 4: a repeated row does not switch off the backwards-date check', () => {
  // truth: a, b, c, d all 03/01; c misread 04/01; d repeats b's amount and balance? no - d is a later +0 pair
  const csv = ['Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00', '15/01/2568,a,100.00,1100.00',
    '15/01/2568,b,-100.00,1000.00', '16/01/2568,c,100.00,1100.00', '15/01/2568,d,-100.00,1000.00',
    '15/01/2568,e,5.00,1005.00', '15/01/2568,f,5.00,1010.00'].join('\n');
  const s = one(csv, { openingText: '1,000.00', closingText: '1,010.00' });
  assert.ok(!(partialRows(s) ?? []).some(r => r.description === 'c'), 'c, read a day late, is held back');
});

test('re-review should-fix: a month-first file puts every either-way date in doubt', () => {
  const csv = ['Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00', '02/04/2025,a,10.00,1010.00',
    '02/10/2025,b,10.00,1020.00', '02/13/2025,c,10.00,1030.00', '02/14/2025,d,10.00,1040.00'].join('\n');
  const s = one(csv, { openingText: '1,000.00', closingText: '1,040.00' });
  const why = Object.fromEntries(s.rows.map(r => [r.description, r.notes.join(' ')]));
  assert.match(why.a, /month-first/);
  assert.match(why.b, /month-first/);
  assert.ok(!(partialRows(s) ?? []).some(r => r.description === 'a' || r.description === 'b'));
});

test('re-review should-fix: unclosed cells and strings are read in one pass', async () => {
  const { zipStore } = await import('../../src/engine/output/zip.js');
  const part = (name, text) => ({ name, data: new TextEncoder().encode(text) });
  const book = (sheet, sst) => zipStore([
    part('xl/workbook.xml', '<workbook><sheets><sheet name="s" r:id="r1"/></sheets></workbook>'),
    part('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'),
    part('xl/sharedStrings.xml', sst), part('xl/worksheets/sheet1.xml', sheet)]);
  const t = Date.now();
  await readXlsx(book('<sheetData><row>' + '<c><v>1'.repeat(200) + '</row>' + '<row><c><v>1</v></c></row>'.repeat(100) + '</sheetData>',
    '<sst>' + '<si><t>x'.repeat(200000) + '</sst>')).catch(e => assert.equal(e.code, 'too-big'));
  assert.ok(Date.now() - t < 3000, `${Date.now() - t} ms`);
});

// G8 review 3 probes (truth in each comment).
const amountsFile = (opening, amounts) => {
  let bal = opening;
  const out = ['Date,Description,Amount,Balance', `,ยอดยกมา,,${Math.abs(opening)}.00`];
  amounts.forEach((a, k) => { bal += a; out.push(`${String(15 + k).padStart(2, '0')}/01/2568,t${k},${a < 0 ? '-' : ''}${Math.abs(a)}.00,${Math.abs(bal)}.00`); });
  return { csv: out.join('\n'), closing: bal };
};

test('review 3 B-1: an overdrawn stretch read without its minus signs never goes', () => {
  // truth: 1000 -> -500 -> -600 -> -650 -> -680 -> 1320; the balances lost their minus signs
  let sentAny = false;
  for (const amounts of [[-1500, -100, -50, -30, 2000], [-1000, -200, -100, 300, 500]]) {
    const { csv, closing } = amountsFile(1000, amounts);
    const s = one(csv, { openingText: '1,000.00', closingText: `${closing}.00` });
    const real = new Set(amountsFile(1000, amounts).csv.split('\n').slice(2).map((l, k) => k));
    let bal = 1000;
    const truth = amounts.map(a => { bal += a; return bal; });
    for (const r of partialRows(s) ?? (statusOf(s) === 'yellow' ? s.rows : [])) {
      const k = Number(r.description.slice(1));
      assert.equal(r.balance, truth[k] * 100, `t${k} sent with a balance that is not the truth`);
    }
    assert.ok(real.size);
    sentAny ||= (partialRows(s) ?? (statusOf(s) === 'yellow' ? s.rows : [])).length > 0;
  }
  assert.ok(sentAny, 'some proved lines are sent, so the balance check above has something to check');
  // a typed 0 proves nothing: an overdrawn account from 0 to 0
  const zero = amountsFile(0, [-200, -100, 300]);
  const z = one(zero.csv, { openingText: '0', closingText: '0' });
  assert.equal(partialRows(z) ?? (statusOf(z) === 'yellow' ? z.rows : null), null);
});

test('review 3 B-2: month-first dates are doubted across files and on big jumps', () => {
  const p1 = 'Date,Description,Amount,Balance\n,ยอดยกมา,,1000.00\n02/01/2025,a,10.00,1010.00\n02/03/2025,b,10.00,1020.00\n02/05/2025,c,10.00,1030.00';
  const p2 = 'Date,Description,Amount,Balance\n02/14/2025,d,10.00,1040.00\n02/20/2025,e,10.00,1050.00';
  const s = tableStatement('x', [{ name: 'a', rows: sheetOf(p1) }, { name: 'b', rows: sheetOf(p2) }], MAP,
    { openingText: '1,000.00', closingText: '1,050.00' });
  assert.ok(!(partialRows(s) ?? []).some(r => ['a', 'b', 'c'].includes(r.description)), 'no either-way date goes');
  // one file, days 1-12 only: nothing shows the order
  const only = one(p1, { openingText: '1,000.00', closingText: '1,030.00' });
  assert.ok(!(partialRows(only) ?? (statusOf(only) === 'yellow' ? only.rows : [])).some(r => r.description === 'b'));
});

test('review 3 B-3: an ordinary line on a later file is not taken for a heading', () => {
  const p1 = 'Date,Description,Withdrawal,Deposit,Balance\n,ยอดยกมา,,,1000.00\n15/01/2568,a,,10.00,1010.00';
  const p2 = ['16/01/2568,รับโอน,,300.00,1310.00', '16/01/2568,ถอนเงินสด ATM,295.00,,1015.00', '16/01/2568,x,5.00,,1010.00',
    '17/01/2568,ถอนเงินสด ATM,รับโอน,,1010.00', '18/01/2568,b,,10.00,1020.00'].join('\n');
  const map = { date: 0, description: 1, withdrawal: 2, deposit: 3, balance: 4 };
  const s = tableStatement('x', [{ name: 'a', rows: sheetOf(p1) }, { name: 'b', rows: sheetOf(p2) }], map,
    { openingText: '1,000.00', closingText: '1,020.00' });
  assert.ok(s.rows.some(r => r.description === 'รับโอน'), 'the rows above the look-alike line are read');
});

test('review 3 B-4: a CSV of blank lines is refused while it is read', () => {
  const t = Date.now();
  assert.throws(() => readCsv('\n'.repeat(2e6)), { code: 'too-big' });
  assert.ok(Date.now() - t < 1000);
});

// G8 review 4 probes (truth in each comment).
test('review 4 P1: a stretch below zero read without minus signs does not go, even when every check passes', () => {
  // truth: 100 -> 0 -> -50 -> -20 -> 0 -> 70; balances read without their minus signs
  const csv = ['Date,Description,Amount,Balance', ',ยอดยกมา,,100.00', '15/01/2568,a,100.00,0.00', '16/01/2568,b,50.00,50.00',
    '17/01/2568,c,30.00,20.00', '18/01/2568,d,20.00,0.00', '19/01/2568,e,70.00,70.00'].join('\n');
  const s = one(csv, { openingText: '100.00', closingText: '70.00' });
  const sent = groupBatch([s])[0].expressRows().map(r => r.description);
  for (const d of ['b', 'c', 'd']) assert.ok(!sent.includes(d), `${d} must not go: its direction is not proved`);
});

test('review 4 P3: a month-first page whose days are all 1-12 is doubted', () => {
  // truth: 01 Oct .. 12 Oct 2025, written month-first
  const lines = ['Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00'];
  for (let m = 1; m <= 12; m++) lines.push(`10/${String(m).padStart(2, '0')}/2025,t${m},10.00,${1000 + 10 * m}.00`);
  const s = one(lines.join('\n'), { openingText: '1,000.00', closingText: '1,120.00' });
  const sent = groupBatch([s])[0].expressRows();
  assert.ok(!sent.some(r => r.date !== '2025-10-10' && r.date.slice(8) === '10'), 'no either-way date goes as read');
});

test('review 4 P4b: Excel date numbers a converter swapped are doubted', () => {
  // truth: 03/02, 04/03, 05/06 ... (day first); stored as date numbers already swapped (2 Mar, 3 Apr, 6 May)
  const serial = iso => (Date.parse(iso) - Date.UTC(1899, 11, 30)) / 864e5;
  const rows = [['Date', 'Description', 'Amount', 'Balance'], ['', 'ยอดยกมา', '', 1000],
    [serial('2025-03-02'), 'a', 10, 1010], [serial('2025-04-03'), 'b', 10, 1020], [serial('2025-06-05'), 'c', 10, 1030]];
  const s = tableStatement('x', [{ name: 'x', rows }], MAP, { openingText: '1,000.00', closingText: '1,030.00' });
  assert.equal(groupBatch([s])[0].expressRows().length, 0, 'no swapped date goes');
});

// G8 review 5 probes (truth in each comment).
const sentOf = s => groupBatch([s])[0].expressRows();
test('review 5 B1: US-order dates with a Buddhist year are still doubted', () => {
  // truth: 1, 2, 3, 13, 14 April 2025, written month-first with Buddhist years
  for (const year of ['2568', '68']) {
    const csv = ['Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00', `04/01/${year},a,10.00,1010.00`, `04/02/${year},b,10.00,1020.00`,
      `04/03/${year},c,10.00,1030.00`, `04/13/${year},d,10.00,1040.00`, `04/14/${year},e,10.00,1050.00`].join('\n');
    const s = one(csv, { openingText: '1,000.00', closingText: '1,050.00' });
    assert.ok(!sentOf(s).some(r => ['a', 'b', 'c'].includes(r.description)), `${year}: no swapped date goes`);
    const only = one(csv.split('\n').slice(0, 5).join('\n'), { openingText: '1,000.00', closingText: '1,030.00' });
    assert.ok(!sentOf(only).some(r => ['a', 'b', 'c'].includes(r.description)), 'a Buddhist year alone does not show the order');
  }
});

test('review 5 S1: each file proves its own date order', () => {
  // truth: file 1 converted day-first (20, 28 March); file 2 with a US setting: 5-7 April became 4 May, 4 June, 4 July
  const serial = iso => (Date.parse(iso) - Date.UTC(1899, 11, 30)) / 864e5;
  const f1 = [['Date', 'Description', 'Amount', 'Balance'], ['', 'ยอดยกมา', '', 1000], [serial('2025-03-20'), 'a', 10, 1010], [serial('2025-03-28'), 'b', 10, 1020]];
  const f2 = [['Date', 'Description', 'Amount', 'Balance'], [serial('2025-05-04'), 'c', 10, 1030], [serial('2025-06-04'), 'd', 10, 1040], [serial('2025-07-04'), 'e', 10, 1050]];
  const s = tableStatement('x', [{ name: 'a', rows: f1 }, { name: 'b', rows: f2 }], MAP, { openingText: '1,000.00', closingText: '1,050.00' });
  assert.ok(!sentOf(s).some(r => ['c', 'd', 'e'].includes(r.description)));
});

test('review 5 S2: a transaction above a repeated heading is read, not dropped', () => {
  // truth: +100 then -100 (a reversal) sit above a heading copied mid-sheet
  const f2 = ['16/01/2568,x,100.00,1110.00', '16/01/2568,y,-100.00,1010.00', 'Date,Description,Amount,Balance', '17/01/2568,z,10.00,1020.00'].join('\n');
  const f1 = 'Date,Description,Amount,Balance\n,ยอดยกมา,,1000.00\n15/01/2568,a,10.00,1010.00';
  const s = tableStatement('x', [{ name: 'a', rows: sheetOf(f1) }, { name: 'b', rows: sheetOf(f2) }], MAP, { openingText: '1,000.00', closingText: '1,020.00' });
  assert.ok(s.rows.some(r => r.description === 'x') && s.rows.some(r => r.description === 'y'));
});

test('review 5: the typed opening is the opening; row 1 misread in amount and balance is held', () => {
  // truth: opening 1,000.00 (no brought-forward line); +250.00 -> 1,250.00, read +850.00 -> 1,850.00
  const csv = 'Date,Description,Amount,Balance\n15/01/2568,a,850.00,1850.00\n16/01/2568,b,-200.00,1050.00\n17/01/2568,c,10.00,1060.00';
  const s = one(csv, { openingText: '1,000.00', closingText: '1,060.00' });
  assert.ok(!sentOf(s).some(r => r.description === 'a'));
  // a typed 0 says why it cannot help
  const z = one(csv, { openingText: '0', closingText: '1,060.00' });
  assert.match(z.checks.find(([l]) => l.startsWith('First line'))[2], /cannot show which way/);
});

test('review 5: more than 50 sheets is refused', async () => {
  const { zipStore } = await import('../../src/engine/output/zip.js');
  const part = (name, text) => ({ name, data: new TextEncoder().encode(text) });
  const sheets = n => '<workbook><sheets>' + Array.from({ length: n }, (_, k) => `<sheet name="s${k}" r:id="r1"/>`).join('') + '</sheets></workbook>';
  const book = n => zipStore([part('xl/workbook.xml', sheets(n)),
    part('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'),
    part('xl/worksheets/sheet1.xml', '<sheetData><row><c><v>1</v></c></row></sheetData>')]);
  await assert.rejects(readXlsx(book(51)), { code: 'too-big' });
  assert.equal((await readXlsx(book(50))).length, 50);
});

// G8 review 6 probes (truth in each comment).
test('review 6 B1: a later file must prove its own date order', () => {
  const serial = iso => (Date.parse(iso) - Date.UTC(1899, 11, 30)) / 864e5;
  const f1 = [['Date', 'Description', 'Amount', 'Balance'], ['', 'ยอดยกมา', '', 1000], [serial('2025-02-20'), 'a', 10, 1010], [serial('2025-03-02'), 'b', 10, 1020]];
  // truth: 3 Apr, 3 May, 3 Jun (a monthly transfer) stored by a US-set converter as 4, 5, 6 March
  const f2 = [['Date', 'Description', 'Amount', 'Balance'], [serial('2025-03-04'), 'c', 10, 1030], [serial('2025-03-05'), 'd', 10, 1040], [serial('2025-03-06'), 'e', 10, 1050]];
  const s = tableStatement('x', [{ name: 'a', rows: f1 }, { name: 'b', rows: f2 }], MAP, { openingText: '1,000.00', closingText: '1,050.00' });
  assert.ok(!sentOf(s).some(r => ['c', 'd', 'e'].includes(r.description)));
  // one line, text, month-first: 04/03/2025 meant 3 April
  const t2 = 'Date,Description,Amount,Balance\n04/03/2025,c,10.00,1030.00';
  const t = tableStatement('x', [{ name: 'a', rows: f1 }, { name: 'b', rows: sheetOf(t2) }], MAP, { openingText: '1,000.00', closingText: '1,030.00' });
  assert.ok(!sentOf(t).some(r => r.description === 'c'));
});

test('review 6 SF2: a summary above the heading stays out of the lines', () => {
  const csv = ['Summary,,,', ',Total withdrawals,30.00,1020.00', ',Carried forward,20.00,1020.00', 'Date,Description,Amount,Balance',
    ',ยอดยกมา,,1000.00', '13/01/2568,a,10.00,1010.00', '14/01/2568,b,10.00,1020.00'].join('\n');
  const s = one(csv, { openingText: '1,000.00', closingText: '1,020.00' });
  assert.equal(s.rows.length, 2);
  assert.equal(statusOf(s), 'yellow');
});

// G8 review 7 probes (truth in each comment).
test('review 7 B-1: one misread date does not prove a file', () => {
  const serial = iso => (Date.parse(iso) - Date.UTC(1899, 11, 30)) / 864e5;
  // truth 1-11 Oct, stored by a US-set converter as 10 Jan, 10 Feb...; "05/10" misread "05/18" -> 18 May
  const rows = [['Date', 'Description', 'Amount', 'Balance'], ['', 'ยอดยกมา', '', 1000]];
  let bal = 1000;
  for (const d of [1, 2, 3, 5, 6, 8, 9, 11]) { bal += 10; rows.push([serial(d === 5 ? '2025-05-18' : `2025-${String(d).padStart(2, '0')}-10`), 't' + d, 10, bal]); }
  const s = tableStatement('x', [{ name: 'p', rows }], MAP, { openingText: '1,000.00', closingText: `${bal}.00` });
  assert.equal(sentOf(s).length, 0, 'no swapped date goes');
  // text, month-first, one misread "04/08" -> "14/08"
  const lines = ['Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00'];
  bal = 1000;
  for (const d of [1, 3, 5, 8, 10]) { bal += 10; lines.push(`${d === 8 ? '14/08/2025' : `04/${String(d).padStart(2, '0')}/2025`},t${d},10.00,${bal}.00`); }
  const t = one(lines.join('\n'), { openingText: '1,000.00', closingText: `${bal}.00` });
  assert.equal(sentOf(t).length, 0, 'no text date goes, the misread one included');
  // date numbers beside text dates over 12: the converter's mark
  const mixed = [['Date', 'Description', 'Amount', 'Balance'], ['', 'ยอดยกมา', '', 1000]];
  bal = 1000;
  for (const d of [3, 7, 11, 13, 20]) { bal += 10; mixed.push([d <= 12 ? serial(`2025-${String(d).padStart(2, '0')}-10`) : `${d}/10/2025`, 't' + d, 10, bal]); }
  const m = tableStatement('x', [{ name: 'p', rows: mixed }], MAP, { openingText: '1,000.00', closingText: `${bal}.00` });
  assert.ok(!sentOf(m).some(r => ['t3', 't7', 't11'].includes(r.description)));
});

test('review 7 S-1: a date over 12 late in the file proves the lines after it too', () => {
  const csv = ['Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00', '25/09/2025,a,10.00,1010.00', '28/09/2025,b,10.00,1020.00',
    '01/10/2025,c,10.00,1030.00', '03/10/2025,d,10.00,1040.00', '06/10/2025,e,10.00,1050.00'].join('\n');
  const s = one(csv, { openingText: '1,000.00', closingText: '1,050.00' });
  assert.equal(sentOf(s).length, 5);
});

test('review 7 S-2: a totals row that starts with a date stays out', () => {
  const csv = ['31/01/2568,Total credit,20.00,1020.00', 'Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00',
    '13/01/2568,a,10.00,1010.00', '14/01/2568,b,10.00,1020.00'].join('\n');
  const s = one(csv, { openingText: '1,000.00', closingText: '1,020.00' });
  assert.equal(s.rows.length, 2);
});

test('review 7 B-2: a workbook counting dates from 1904 is refused', async () => {
  const { zipStore } = await import('../../src/engine/output/zip.js');
  const bytes = zipStore([{ name: 'xl/workbook.xml', data: '<workbook><workbookPr date1904="1"/><sheets/></workbook>' }]);
  await assert.rejects(readXlsx(bytes), e => e.code === 'date-1904');
  const odd = zipStore([{ name: 'xl/workbook.xml', data: "<x:workbook><x:workbookPr date1904 = '1'/></x:workbook>" }]);
  await assert.rejects(readXlsx(odd), e => e.code === 'date-1904');
});

// Co 2026-10-09: an overdraft the checks cannot see, and dates, are said to the person - nothing is held.
test('warnings: one unsigned amount column says the overdraft risk; dates are always said', async () => {
  const { WARN_OVERDRAFT, WARN_DATES } = await import('../../src/table/statement.js');
  const unsigned = one(['Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00', '13/01/2568,a,10.00,1010.00', '14/01/2568,b,10.00,1020.00'].join('\n'),
    { openingText: '1,000.00', closingText: '1,020.00' });
  assert.deepEqual(unsigned.warnings, [WARN_OVERDRAFT, WARN_DATES]);
  assert.equal(sentOf(unsigned).length, 2, 'nothing is held because of a warning');
  const signed = one(['Date,Description,Amount,Balance', ',ยอดยกมา,,1000.00', '13/01/2568,a,-10.00,990.00', '14/01/2568,b,10.00,1000.00'].join('\n'),
    { openingText: '1,000.00', closingText: '1,000.00' });
  assert.deepEqual(signed.warnings, [WARN_DATES]);
  const twoCols = tableStatement('x', [{ name: 'x', rows: sheetOf('Date,Description,Withdrawal,Deposit,Balance\n,ยอดยกมา,,,1000.00\n13/01/2568,a,,10.00,1010.00') }],
    { date: 0, description: 1, withdrawal: 2, deposit: 3, balance: 4 }, { openingText: '1,000.00', closingText: '1,010.00' });
  assert.deepEqual(twoCols.warnings, [WARN_DATES]);
});
