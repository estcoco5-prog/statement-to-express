// The page: pick PDFs -> read and prove each -> one Express file per account,
// a Review file per statement. Nothing is stored or sent: the files, any
// password and every result live only in this run and are dropped with it.
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { readStatement, partialRows, rowsToCheck } from './engine/statement.js';
import { StatementError } from './engine/errors.js';
import { groupBatch } from './engine/batch.js';
import { expressFiles, reviewFileName } from './engine/output/express.js';
import { buildWorkbook } from './engine/output/review.js';
import { writeXlsx } from './engine/output/xlsx.js';
import { PROFILES } from './engine/profiles.js';
import { summarise, MESSAGES, STATUS_TEXT, UNTESTED_TEXT, PHOTO_TEXT, PARTIAL_TEXT } from './view.js';
import { photoPage, pageSizeFor, imageMatrix } from './photo/pipeline.js';
import { buildReadablePdf } from './photo/pdfwrite.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const $ = id => document.getElementById(id);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Build an element with plain text only - a file name is never read as HTML.
function el(tag, cls, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

// ---- the bank list ---------------------------------------------------------
for (const p of Object.values(PROFILES)) $('bankList').append(el('li', '', `✅ ${p.bank}`));

// ---- picking files ---------------------------------------------------------
let busy = false;
$('picker').addEventListener('change', e => { run([...e.target.files]); e.target.value = ''; });

const zone = $('dropzone');
for (const type of ['dragenter', 'dragover']) {
  zone.addEventListener(type, e => { e.preventDefault(); zone.classList.add('dragging'); });
}
for (const type of ['dragleave', 'drop']) zone.addEventListener(type, () => zone.classList.remove('dragging'));
zone.addEventListener('drop', e => { e.preventDefault(); run([...e.dataTransfer.files]); });
// A file dropped anywhere else must not make the browser open it instead.
for (const type of ['dragover', 'drop']) window.addEventListener(type, e => e.preventDefault());

$('againBtn').addEventListener('click', () => { clearResults(); clearPictures(); clearPhotos(); clearPassbook(); clearTables(); window.scrollTo(0, 0); });

// ---- one run -----------------------------------------------------------------
const isLocked = entry => entry.error && (entry.error.code === 'locked' || entry.error.code === 'wrong-password');

async function readInto(entries, passwords) {
  let n = 0;
  for (const entry of entries) {
    n += 1;
    $('progress').textContent = `Reading ${n} of ${entries.length}: ${entry.name} · กำลังอ่าน`;
    try {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      entry.statement = await readStatement(entry.name, bytes, passwords, null, pdfjs);
      entry.error = null;
    } catch (e) {
      entry.statement = null;
      entry.error = e instanceof StatementError
        ? { code: e.code, message: e.message }
        : { code: 'refused', message: 'an unexpected problem stopped this file being read' };
      if (!(e instanceof StatementError)) console.error(e);
    }
  }
}

async function run(files) {
  if (busy || !files.length) return;
  busy = true;
  clearResults();
  const passwords = [];                     // this run only - dropped when it ends
  const entries = files.map(file => ({ file, name: file.name, statement: null, error: null }));
  try {
    await readInto(entries, passwords);
    while (entries.some(isLocked)) {
      const locked = entries.filter(isLocked);
      const answer = await askPassword(locked);
      if (answer === null) break;           // skipped: those files stay locked
      passwords.push(answer);
      await readInto(locked, passwords);
    }
    passwords.length = 0;
    show(entries);
  } finally {
    passwords.length = 0;
    $('progress').textContent = '';
    busy = false;
  }
}

// One box, naming the first locked file. Resolves with the password, or null.
function askPassword(locked) {
  const [first] = locked;
  $('lockedName').textContent = `${first.name} is locked · ไฟล์นี้ล็อกอยู่`;
  $('lockedMore').textContent = locked.length > 1
    ? `${locked.length - 1} more locked file(s) will be tried with the same password too.` : '';
  const wrong = locked.some(e => e.error.code === 'wrong-password');
  $('passwordWrong').hidden = !wrong;
  $('passwordWrong').textContent = `${MESSAGES['wrong-password'].en} · ${MESSAGES['wrong-password'].th}`;
  $('passwordPanel').hidden = false;
  $('passwordInput').value = '';
  $('passwordInput').focus();
  return new Promise(resolve => {
    const done = value => {
      $('passwordForm').onsubmit = null;
      $('skipBtn').onclick = null;
      $('passwordInput').value = '';
      $('passwordPanel').hidden = true;
      resolve(value);
    };
    $('passwordForm').onsubmit = e => {
      e.preventDefault();
      const value = $('passwordInput').value;
      if (value) done(value);
    };
    $('skipBtn').onclick = () => done(null);
  });
}

// ---- results -----------------------------------------------------------------
let made = [];                              // [{ fileName, bytes }] for this result only

function clearResults() {
  made = [];
  $('results').hidden = true;
  for (const id of ['banner', 'refusals', 'accounts']) $(id).replaceChildren();
}

const period = s => (s.facts.period_from ? `${s.facts.period_from} – ${s.facts.period_to}` : '(period not read)');

function show(entries) {
  const statements = entries.filter(e => e.statement).map(e => e.statement);
  const groups = groupBatch(statements);
  const outs = expressFiles(groups);
  made = [];
  const reviewBytes = new Map();
  for (const s of statements) {
    reviewBytes.set(s, writeXlsx(buildWorkbook(s.rows, s.opening, s.closing, s.facts, s.checks, s.profile, s.name, s.fromPhoto)));
  }
  const results = {
    groups: groups.map((g, i) => ({
      bank: g.profile.bank,
      account: g.account,
      untested: g.profile.untested,
      photo: g.statements.some(s => s.fromPhoto),
      statuses: g.statements.map(s => (g.isPartial(s) ? 'partial' : g.status(s))),
      statements: g.statements.map(s => ({
        name: s.name, period: period(s), rows: s.rows.length, status: g.isPartial(s) ? 'partial' : g.status(s),
        leftOut: g.leftOutReason(s), failed: s.checks.filter(([, ok]) => !ok),
        partial: g.isPartial(s) ? { toExpress: partialRows(s).length, toCheck: rowsToCheck(s).length,
          pages: [...new Set(rowsToCheck(s).map(r => r.page).filter(Boolean))] } : null,
      })),
      checks: g.checks,
      // said to the person, never acted on (table/statement.js)
      warnings: [...new Map(g.statements.flatMap(s => s.warnings ?? []).map(w => [w.en, w])).values()],
      express: outs[i].fileName ? { fileName: outs[i].fileName, rows: outs[i].n } : { refused: outs[i].refused },
      reviews: g.statements.map(s => reviewFileName(s.name)),
      expressBytes: outs[i].bytes ?? null,
      reviewBytes: g.statements.map(s => reviewBytes.get(s)),
    })),
    refusals: entries.filter(e => e.error).map(e => ({ name: e.name, ...e.error })),
  };
  const v = summarise(results);

  const t = STATUS_TEXT[v.banner];
  $('banner').className = `banner s-${v.banner}`;
  $('banner').append(`${t.icon} ${t.en}`, el('span', 'th', t.th));
  if (v.refusals.length) {
    $('banner').append(el('span', 'th', `⛔ ${v.refusals.length} file(s) could not be used - see below · มีไฟล์ที่ใช้ไม่ได้`));
  }

  const fileOf = new Map(entries.map(e => [e.name, e.file]));
  for (const r of v.refusals) {
    const card = el('div', 'card refusal',
      el('h3', '', `⛔ ${r.name}`), el('p', '', r.en), el('p', 'sub', r.th),
      r.detail ? el('p', 'detail', r.detail) : '');
    if (r.code === 'no-text' && fileOf.has(r.name)) {
      // A scan: its pages are pictures, so read them the way photos are read.
      const b = el('button', 'btn', 'Read it as photos · อ่านเป็นรูปถ่าย');
      b.type = 'button';
      b.addEventListener('click', async () => {
        const { picturesFromPdf } = await import('./photo/ocr.js');
        addPhotos(await picturesFromPdf(new Uint8Array(await fileOf.get(r.name).arrayBuffer()), pdfjs));
      });
      card.append(b);
    }
    $('refusals').append(card);
  }

  v.accounts.forEach((a, i) => $('accounts').append(accountCard(a, results.groups[i])));
  $('results').hidden = false;
}

function accountCard(a, g) {
  const t = STATUS_TEXT[a.status];
  const card = el('div', 'card',
    el('h3', '', `${a.bank} · ${a.account}`),
    el('p', `status s-${a.status}`, `${t.icon} ${t.en} · ${t.th}`));
  if (a.untested) card.append(el('p', 'caveat', `⚠ ${UNTESTED_TEXT.en} · ${UNTESTED_TEXT.th}`));
  if (a.photo) card.append(el('p', 'caveat', `📷 ${PHOTO_TEXT.en} · ${PHOTO_TEXT.th}`));
  for (const w of g.warnings ?? []) card.append(el('p', 'caveat', `⚠ ${w.en} · ${w.th}`));

  const rows = a.statements.map(s => el('tr', '',
    el('td', '', `${STATUS_TEXT[s.status].icon} ${s.name}`),
    el('td', '', s.period),
    el('td', 'num', s.rows),
    el('td', '', s.leftOut ? `LEFT OUT - ${s.leftOut}`
      : s.partial ? `🟠 ${PARTIAL_TEXT.en(s.partial)} · ${PARTIAL_TEXT.th(s.partial)}`
      : s.failed.length ? s.failed.map(([label, , detail]) => `${label}: ${detail}`).join('; ') : 'OK')));
  card.append(el('div', 'table-wrap', el('table', '',
    el('thead', '', el('tr', '', el('th', '', 'Statement · ใบแจ้งยอด'), el('th', '', 'Period · ช่วงเวลา'),
      el('th', '', 'Rows · รายการ'), el('th', '', 'Result · ผล'))),
    el('tbody', '', ...rows))));

  if (a.checks.length) {
    card.append(el('ul', 'checks', ...a.checks.map(([label, ok, detail]) =>
      el('li', '', `${ok ? '✔' : '✖'} ${label}${detail && detail !== 'none' ? ` - ${detail}` : ''}`))));
  }

  const dl = el('div', 'dl');
  if (a.express?.fileName) {
    dl.append(downloadButton(a.express.fileName, g.expressBytes, 'btn primary',
      `⬇ Express file · ไฟล์ Express (${a.express.rows} rows)`));
  } else {
    dl.append(el('p', 'bad', `No Express file for this account: ${a.express.refused} · ไม่มีไฟล์ Express`));
  }
  a.reviews.forEach((name, i) => dl.append(downloadButton(name, g.reviewBytes[i], 'btn', `⬇ Review: ${name}`)));
  card.append(dl);
  if (a.express?.fileName) {
    card.append(el('p', 'steps', el('b', '', 'Before importing · ก่อนนำเข้า: '),
      '1. fill every YELLOW cell (DOCNUM, BNKACC) · กรอกช่องสีเหลือง  2. delete columns G and H (ถอน, ฝาก) · ลบคอลัมน์ G และ H'));
  }
  return card;
}

function saveBytes(fileName, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = el('a', '');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);   // after the browser has taken it
}

function downloadButton(fileName, bytes, cls, label) {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', () => saveBytes(fileName, bytes, XLSX));
  return b;
}

// ---- pictures -> Excel ------------------------------------------------------------
// Any bank's statement pictures -> the tables, shown to check and fix, saved as
// Excel. Read on this computer; the pictures and tables live only in this tab.
let pictures = [];                          // [{ file, name, thumb }] in page order
let pictureTables = null;                   // [{ name, rows, other, map, dayFirst }] once read
let pictureLit = null;                      // their traffic lights (picture/lights.js), as the cells stand now
let pictureMarks = [];                      // per table, per row: the cells that show its light
let relightTimer = null;

$('picturePicker').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (busy) return pictureError('⛔ Still working - choose the pictures again when it finishes. · กำลังทำงานอยู่');
  await addPictures(files);
});
$('pictureClear').addEventListener('click', clearPictures);
// a different reader: the tables read before no longer stand
$('picturePassbook').addEventListener('change', () => { pictureTables = null; pictureError(''); clearResults(); drawPictures(); });

function pictureError(text) {
  $('pictureError').hidden = !text;
  $('pictureError').textContent = text || '';
}

async function addPictures(files) {
  pictureError('');
  let tooMany = 0;
  for (const file of files) {
    if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      try {
        const { picturesFromPdf } = await import('./photo/ocr.js');
        $('progress').textContent = `Opening ${file.name} · กำลังเปิดไฟล์`;
        const pages = await picturesFromPdf(new Uint8Array(await file.arrayBuffer()), pdfjs);
        pages.forEach((f, i) => {
          if (pictures.length >= MAX_PHOTOS) { tooMany++; return; }
          pictures.push({ file: f, name: `${file.name} - page ${i + 1}`, thumb: URL.createObjectURL(f) });
        });
      } catch {
        pictureError(`⛔ ${file.name}: ${MESSAGES['not-pdf'].en} · ${MESSAGES['not-pdf'].th}`);
      } finally {
        $('progress').textContent = '';
      }
    } else if (pictures.length >= MAX_PHOTOS) tooMany++;
    else pictures.push({ file, name: file.name, thumb: URL.createObjectURL(file) });
  }
  if (tooMany) pictureError(`⛔ ${tooMany} picture(s) not added: at most ${MAX_PHOTOS} at a time · ไม่ได้เพิ่ม ${tooMany} รูป`);
  pictureTables = null;
  clearResults();
  drawPictures();
}

function clearPictures() {
  if (busy) return;
  for (const p of pictures) URL.revokeObjectURL(p.thumb);
  pictures = [];
  pictureTables = null;
  pictureLit = null;
  clearResults();
  $('pictureOpening').value = '';
  $('pictureClosing').value = '';
  $('pictureAccount').value = '';
  $('picturePassbook').checked = false;
  drawPictures();
}

function drawPictures() {
  $('picturePanel').hidden = !pictures.length;
  $('pictureResult').hidden = !pictureTables;
  $('pictureList').replaceChildren(...pictures.map((p, i) => {
    const img = el('img', 'thumb');
    img.src = p.thumb;
    img.alt = '';
    const move = (label, to, aria) => {
      const b = el('button', 'btn small', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.disabled = to < 0 || to >= pictures.length;
      b.addEventListener('click', () => { [pictures[i], pictures[to]] = [pictures[to], pictures[i]]; pictureTables = null; clearResults(); drawPictures(); });
      return b;
    };
    const drop = el('button', 'btn small', '✕');
    drop.type = 'button';
    drop.setAttribute('aria-label', `remove ${p.name}`);
    drop.addEventListener('click', () => { URL.revokeObjectURL(p.thumb); pictures.splice(i, 1); pictureTables = null; clearResults(); drawPictures(); });
    return el('li', '', img, el('span', 'name', `${i + 1}. ${p.name}`),
      move('◀', i - 1, 'move earlier'), move('▶', i + 1, 'move later'), drop);
  }));
  drawPictureTables();
}

// One table per picture; every cell can be corrected by hand (what is typed is
// what goes into the Excel file - nothing is re-read).
function drawPictureTables() {
  pictureMarks = [];
  if (!pictureTables) { $('pictureTables').replaceChildren(); return; }
  $('pictureTables').replaceChildren(...pictureTables.map((t, k) => {
    const box = el('div', 'picture-table');
    box.append(el('h4', '', `${k + 1}. ${t.name}`));
    pictureMarks[k] = [];
    if (t.error) { box.append(el('p', 'bad', `⛔ ${t.error}`)); return box; }
    const table = el('table', 'preview');
    t.rows.forEach((row, r) => {
      const tr = el('tr', '');
      const light = el(r === 0 ? 'th' : 'td', 'light', r === 0 ? 'Light · ไฟ' : '');
      tr.append(light);
      row.forEach((cellText, c) => {
        const td = el(r === 0 ? 'th' : 'td', '');
        td.textContent = cellText;
        td.contentEditable = 'true';
        td.spellcheck = false;
        td.addEventListener('input', () => { t.rows[r][c] = td.textContent.trim(); relightSoon(); });
        tr.append(td);
      });
      const why = el(r === 0 ? 'th' : 'td', 'why', r === 0 ? 'Why · เหตุผล' : '');
      tr.append(why);
      pictureMarks[k][r] = { tr, light, why };
      table.append(tr);
    });
    box.append(el('div', 'table-wrap', table));
    return box;
  }));
  relight();
}

const LIGHT_WORD = { green: 'Green · เขียว', yellow: 'Yellow · เหลือง', red: 'Red · แดง', none: 'not a line · ไม่ใช่รายการ' };
// A change after converting: the Express results shown were made from the old cells.
const relightSoon = () => { clearResults(); clearTimeout(relightTimer); relightTimer = setTimeout(relight, 250); };
for (const id of ['pictureOpening', 'pictureClosing']) $(id).addEventListener('input', relightSoon);

// Check the tables again as they stand now (typed balances included) and paint the lights.
async function relight() {
  clearTimeout(relightTimer);
  if (!pictureTables) return;
  const { pictureLights } = await import('./picture/lights.js');
  try {
    pictureLit = pictureLights(pictureTables, { openingText: $('pictureOpening').value, closingText: $('pictureClosing').value });
    pictureError('');
  } catch (e) {
    if (e.code !== 'bad-typed') throw e;
    pictureLit = null;
    pictureError(`⛔ ${MESSAGES['bad-typed'].en} · ${MESSAGES['bad-typed'].th}`);
  }
  const bar = $('pictureLight');
  $('pictureWarnings').replaceChildren(...(pictureLit?.warnings ?? []).map(w => el('p', 'caveat', `⚠ ${w.en} · ${w.th}`)));
  if (!pictureLit) {
    bar.className = 'lightbar red';
    bar.replaceChildren(el('span', '', 'Fix the typed balance to see the lights · แก้ยอดที่พิมพ์เพื่อดูไฟ'));
  } else {
    const { light, headline, counts } = pictureLit.set;
    const dot = el('span', `dot ${light}`);
    bar.className = `lightbar ${light}`;
    bar.replaceChildren(el('span', '', dot, ` ${LIGHT_WORD[light]}: ${headline}`),
      el('span', 'counts', `${counts.green + counts.yellow + counts.red} lines · ${counts.green} green · ${counts.yellow} yellow · ${counts.red} red`));
    $('pictureChecks').replaceChildren(...pictureLit.checks.map(c =>
      el('li', c.passed ? '' : 'fail', `${c.passed ? '✔' : '✘'} ${c.label}${c.detail ? ` - ${c.detail}` : ''}`)));
  }
  pictureMarks.forEach((marks, k) => marks.forEach((m, r) => {
    if (r === 0) return;
    const l = pictureLit?.rows[k]?.[r] ?? null;
    m.tr.className = l ? l.light : '';
    const dot = el('span', `dot ${l?.light ?? 'none'}`);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', l ? LIGHT_WORD[l.light] : 'not checked');
    m.light.replaceChildren(dot);
    m.why.textContent = l?.why ?? '';
  }));
}

$('pictureGo').addEventListener('click', async () => {
  if (busy || !pictures.length) return;
  busy = true;
  $('picturePanel').inert = true;
  $('picturePicker').disabled = true;
  pictureError('');
  clearResults();
  try {
    const { readPhoto, PhotoError } = await import('./photo/ocr.js');
    const { pictureTable } = await import('./picture/table.js');
    const tables = [];
    if ($('picturePassbook').checked) {
      const read = await readPassbookPictures();
      if (!read) { pictureTables = null; drawPictures(); return; }
      tables.push(...read);
    } else for (const [i, p] of pictures.entries()) {
      $('progress').textContent = `Reading picture ${i + 1} of ${pictures.length} · กำลังอ่านรูปที่ ${i + 1} จาก ${pictures.length}`;
      try {
        const { size, ocrWords } = await readPhoto(p.file, s => { $('progress').textContent = s; });
        const t = pictureTable(ocrWords, size);
        tables.push(t.ok ? { name: p.name, ...t } : { name: p.name, error: t.reason, rows: [], other: [] });
      } catch (e) {
        const m = MESSAGES[e instanceof PhotoError && MESSAGES[e.code] ? e.code : 'not-image'];
        tables.push({ name: p.name, error: `${m.en} · ${m.th}`, rows: [], other: [] });
      }
    }
    pictureTables = tables;
  } catch (e) {
    console.error(e);
    pictureError(`⛔ ${MESSAGES.refused.en} · ${MESSAGES.refused.th}`);
  } finally {
    $('progress').textContent = '';
    $('picturePanel').inert = false;
    $('picturePicker').disabled = false;
    busy = false;
  }
  drawPictures();
});

// Ticked "passbook pages": the Passbook card's own reader reads them all at once
// (it learns the printer's dots from the lines it proves), and each page
// becomes a table like any other picture's.
async function readPassbookPictures() {
  const { decodeUpright } = await import('./photo/ocr.js');
  const { readPassbook, greyFromRGBA } = await import('./passbook/reader.js');
  const { KTB_PASSBOOK } = await import('./passbook/printers/ktb.js');
  const { passbookTables } = await import('./picture/passbook.js');
  const grey = [];
  for (const [i, p] of pictures.entries()) {
    $('progress').textContent = `Opening page ${i + 1} of ${pictures.length} · กำลังเปิดหน้า`;
    let canvas;
    try {
      canvas = await decodeUpright(p.file);
    } catch {
      pictureError(`⛔ ${p.name}: ${MESSAGES['not-image'].en} · ${MESSAGES['not-image'].th}`);
      return null;
    }
    grey.push(greyFromRGBA(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height));
  }
  const lines = await readPassbook(grey, KTB_PASSBOOK, ({ step, page, pages }) => {
    $('progress').textContent = `${step === 'reread' ? 'Reading again with what it learned' : 'Reading'} page ${page} of ${pages} · กำลังอ่านหน้า ${page}/${pages}`;
  });
  if (!lines.some(l => l.balance)) {
    pictureError(`⛔ ${MESSAGES['not-passbook'].en} · ${MESSAGES['not-passbook'].th}`);
    return null;
  }
  return passbookTables(lines, pictures.map(p => p.name));
}

$('pictureDownload').addEventListener('click', async () => {
  if (!pictureTables) return;
  const { pictureWorkbook } = await import('./picture/excel.js');
  if (!pictureTables.some(t => !t.error)) return pictureError('⛔ No table was read from these pictures. · ไม่มีตารางที่อ่านได้');
  await relight();          // the lights saved are the ones for the cells as they stand
  const stamp = new Date().toISOString().slice(0, 10);
  saveBytes(`${stamp} statement pictures.xlsx`, pictureWorkbook(pictureTables, pictureLit,
    { openingText: $('pictureOpening').value.trim(), closingText: $('pictureClosing').value.trim() }), XLSX);
});

$('pictureAccount').addEventListener('input', () => clearResults());

// Convert to Express: only when pressed. The tables as they stand (fixes
// included) are checked once more and shown like the Excel card's result:
// proved lines go to Express, the rest to Rows to check.
$('pictureExpress').addEventListener('click', async () => {
  if (busy || !pictureTables) return;
  const unread = pictureTables.map((t, k) => (t.error || !t.rows?.length ? `${k + 1}. ${t.name}` : null)).filter(Boolean);
  if (unread.length) {
    return pictureError(`⛔ Not read: ${unread.join(', ')}. Remove or retake ${unread.length === 1 ? 'it' : 'them'} first, so no page is missing from Express. · ` +
      'มีรูปที่อ่านไม่ได้ ลบหรือถ่ายใหม่ก่อน เพื่อไม่ให้ขาดหน้า');
  }
  // Without a balance typed from the paper, a reading whose minus signs were
  // all lost is a mirror image the chain cannot see (as the Excel card).
  if (!$('pictureOpening').value.trim() && !$('pictureClosing').value.trim()) {
    const m = MESSAGES['need-typed'];
    return pictureError(`⛔ ${m.en} · ${m.th}`);
  }
  busy = true;
  pictureError('');
  clearResults();
  try {
    const { pictureLights } = await import('./picture/lights.js');
    const name = pictures.length === 1 ? pictures[0].name : `${pictures[0].name} (+${pictures.length - 1})`;
    const lit = pictureLights(pictureTables, {
      openingText: $('pictureOpening').value, closingText: $('pictureClosing').value,
      name, account: $('pictureAccount').value.replace(/\D/g, '') || null,
    });
    show([{ name, file: null, statement: lit.statement, error: null }]);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    const m = MESSAGES[e.code === 'bad-typed' ? 'bad-typed' : 'refused'];
    pictureError(`⛔ ${m.en} · ${m.th}`);
  } finally {
    busy = false;
  }
});

// ---- statement photos -> readable PDF (Tool A) --------------------------------
// The photos, their reading and the PDF live only in memory, in this tab:
// Clear or Start again drops them. Anything read from a photo is at most 🟡.
const MAX_PHOTOS = 30;
let photos = [];                            // [{ file, name, thumb }] in page order
let photoPdf = null;                        // the readable PDF, once made

$('photoPicker').addEventListener('change', e => { addPhotos([...e.target.files]); e.target.value = ''; });
$('photoClear').addEventListener('click', clearPhotos);

function addPhotos(files) {
  for (const file of files) {
    if (photos.length >= MAX_PHOTOS) break;
    photos.push({ file, name: file.name, thumb: URL.createObjectURL(file) });
  }
  photoPdf = null;
  drawPhotos();
}

function clearPhotos() {
  for (const p of photos) URL.revokeObjectURL(p.thumb);
  photos = [];
  photoPdf = null;
  drawPhotos();
}

function photoError(text) {
  $('photoError').hidden = !text;
  $('photoError').textContent = text || '';
}

function drawPhotos() {
  $('photoPanel').hidden = !photos.length;
  $('photoDone').hidden = !photoPdf;
  photoError('');
  $('photoList').replaceChildren(...photos.map((p, i) => {
    const img = el('img', 'thumb');
    img.src = p.thumb;
    img.alt = '';
    const move = (label, to, aria) => {
      const b = el('button', 'btn small', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.disabled = to < 0 || to >= photos.length;
      b.addEventListener('click', () => {
        [photos[i], photos[to]] = [photos[to], photos[i]];
        photoPdf = null;
        drawPhotos();
      });
      return b;
    };
    const drop = el('button', 'btn small', '✕');
    drop.type = 'button';
    drop.setAttribute('aria-label', `remove ${p.name}`);
    drop.addEventListener('click', () => { URL.revokeObjectURL(p.thumb); photos.splice(i, 1); photoPdf = null; drawPhotos(); });
    return el('li', '', img, el('span', 'name', `${i + 1}. ${p.name}`),
      move('◀', i - 1, 'move earlier'), move('▶', i + 1, 'move later'), drop);
  }));
}

$('photoGo').addEventListener('click', async () => {
  if (busy || !photos.length) return;
  busy = true;
  photoPdf = null;
  drawPhotos();
  try {
    const { readPhoto } = await import('./photo/ocr.js');
    const pages = [];
    for (const [i, p] of photos.entries()) {
      $('progress').textContent = `Reading photo ${i + 1} of ${photos.length}: ${p.name} · กำลังอ่านรูป`;
      let read;
      try {
        read = await readPhoto(p.file, text => { $('progress').textContent = text; });
      } catch (e) {
        const m = MESSAGES[e.code] ?? MESSAGES.refused;
        return photoError(`⛔ ${p.name}: ${m.en} · ${m.th}`);
      }
      const page = photoPage(read.ocrWords, read.size);
      if (!page.ok) {
        const m = MESSAGES[page.code];
        return photoError(`⛔ ${p.name}: ${m.en} · ${m.th}`);
      }
      const { width, height } = pageSizeFor(page.bank);
      if (pages.length && pages[0].bank !== page.bank) {
        const m = MESSAGES['mixed-banks'];
        return photoError(`⛔ ${p.name}: ${m.en} · ${m.th}`);
      }
      pages.push({ jpeg: read.jpeg, width, height, words: page.words, bank: page.bank, summary: !!page.summary,
        imageMatrix: imageMatrix(page.placement, read.size.w, read.size.h, height) });
    }
    const summaryPages = pages.flatMap((pg, i) => pg.summary ? [i] : []);
    if (summaryPages.length === pages.length) {
      const m = MESSAGES['summary-only'];
      return photoError(`⛔ ${m.en} · ${m.th}`);
    }
    photoPdf = buildReadablePdf(pages, { bank: pages[0].bank, summaryPages });
    drawPhotos();
  } catch (e) {
    console.error(e);
    photoError(`⛔ ${MESSAGES.refused.en} · ${MESSAGES.refused.th}`);
  } finally {
    $('progress').textContent = '';
    busy = false;
  }
});

$('photoDownload').addEventListener('click', () => {
  if (photoPdf) saveBytes('statement-photos.pdf', photoPdf, 'application/pdf');
});
$('photoSend').addEventListener('click', () => {
  if (photoPdf) run([new File([photoPdf], 'statement-photos.pdf', { type: 'application/pdf' })]);
});

// ---- passbook -> Express -------------------------------------------------------
// Scans of a passbook's printed pages, read here by the dot-pattern reader (no
// download, nothing sent). Everything lives in this tab only; Clear drops it.
let passbookPages = [];                     // [{ file, name, thumb }] in page order

$('passbookPicker').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (busy) return;
  await addPassbookFiles(files);
});
$('passbookClear').addEventListener('click', clearPassbook);

function passbookError(text) {
  $('passbookError').hidden = !text;
  $('passbookError').textContent = text || '';
}

async function addPassbookFiles(files) {
  passbookError('');
  for (const file of files) {
    if (passbookPages.length >= MAX_PHOTOS) break;
    if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      try {
        const { picturesFromPdf } = await import('./photo/ocr.js');
        $('progress').textContent = `Opening ${file.name} · กำลังเปิดไฟล์`;
        const pages = await picturesFromPdf(new Uint8Array(await file.arrayBuffer()), pdfjs);
        pages.forEach((f, i) => passbookPages.push({ file: f, name: `${file.name} - page ${i + 1}`, thumb: URL.createObjectURL(f) }));
      } catch {
        passbookError(`⛔ ${file.name}: ${MESSAGES['not-pdf'].en} · ${MESSAGES['not-pdf'].th}`);
      } finally {
        $('progress').textContent = '';
      }
    } else {
      passbookPages.push({ file, name: file.name, thumb: URL.createObjectURL(file) });
    }
  }
  drawPassbook();
}

function clearPassbook() {
  if (busy) return;
  clearResults();
  for (const p of passbookPages) URL.revokeObjectURL(p.thumb);
  passbookPages = [];
  $('passbookAccount').value = '';
  drawPassbook();
}

function drawPassbook() {
  $('passbookPanel').hidden = !passbookPages.length;
  $('passbookList').replaceChildren(...passbookPages.map((p, i) => {
    const img = el('img', 'thumb');
    img.src = p.thumb;
    img.alt = '';
    const move = (label, to, aria) => {
      const b = el('button', 'btn small', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.disabled = to < 0 || to >= passbookPages.length;
      b.addEventListener('click', () => { [passbookPages[i], passbookPages[to]] = [passbookPages[to], passbookPages[i]]; drawPassbook(); });
      return b;
    };
    const drop = el('button', 'btn small', '✕');
    drop.type = 'button';
    drop.setAttribute('aria-label', `remove ${p.name}`);
    drop.addEventListener('click', () => { URL.revokeObjectURL(p.thumb); passbookPages.splice(i, 1); drawPassbook(); });
    return el('li', '', img, el('span', 'name', `${i + 1}. ${p.name}`),
      move('◀', i - 1, 'move earlier'), move('▶', i + 1, 'move later'), drop);
  }));
}

$('passbookGo').addEventListener('click', async () => {
  if (busy || !passbookPages.length) return;
  busy = true;
  // nothing in the panel can change the pages while they are being read
  $('passbookPanel').inert = true;
  $('passbookPicker').disabled = true;
  passbookError('');
  clearResults();
  try {
    const { decodeUpright } = await import('./photo/ocr.js');
    const { readPassbook, greyFromRGBA } = await import('./passbook/reader.js');
    const { KTB_PASSBOOK } = await import('./passbook/printers/ktb.js');
    const { passbookStatement } = await import('./passbook/statement.js');
    const pictures = [];
    for (const [i, p] of passbookPages.entries()) {
      $('progress').textContent = `Opening page ${i + 1} of ${passbookPages.length} · กำลังเปิดหน้า`;
      let canvas;
      try {
        canvas = await decodeUpright(p.file);
      } catch {
        return passbookError(`⛔ ${p.name}: ${MESSAGES['not-image'].en} · ${MESSAGES['not-image'].th}`);
      }
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      pictures.push(greyFromRGBA(data, canvas.width, canvas.height));
    }
    const lines = await readPassbook(pictures, KTB_PASSBOOK, ({ step, page, pages }) => {
      $('progress').textContent = `${step === 'reread' ? 'Reading again with what it learned' : 'Reading'} page ${page} of ${pages} · กำลังอ่านหน้า ${page}/${pages}`;
    });
    pictures.length = 0;
    if (!lines.some(l => l.balance)) {
      const m = MESSAGES['not-passbook'];
      return passbookError(`⛔ ${m.en} · ${m.th}`);
    }
    const statement = passbookStatement('Passbook.pdf', lines, KTB_PASSBOOK,
      { account: $('passbookAccount').value.replace(/\D/g, '') || null });
    show([{ name: 'Passbook.pdf', file: null, statement, error: null }]);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    passbookError(`⛔ ${MESSAGES.refused.en} · ${MESSAGES.refused.th}`);
  } finally {
    $('progress').textContent = '';
    $('passbookPanel').inert = false;
    $('passbookPicker').disabled = false;
    busy = false;
  }
});

// ---- Excel -> Express ------------------------------------------------------------
// Spreadsheets someone made from statement pictures (another tool did the
// reading). Nothing here trusts them: the columns are confirmed on screen and
// every line is proved by its balance. They live in this tab only.
let tableFiles = [];                        // [{ name, rows }] in page order
let tableMap = {};                          // role -> column index

$('tablePicker').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (busy) return tableError('⛔ Still working - choose the files again when it finishes. · กำลังทำงานอยู่ เลือกไฟล์ใหม่อีกครั้งเมื่อเสร็จ');
  await addTables(files);
});
$('tableClear').addEventListener('click', clearTables);

function tableError(text) {
  $('tableError').hidden = !text;
  $('tableError').textContent = text || '';
}

async function addTables(files) {
  busy = true;
  $('tablePanel').inert = true;
  tableError('');
  try {
    const { readTableFile } = await import('./table/read.js');
    const { findColumns } = await import('./table/columns.js');
    const errors = [];
    let tooMany = 0;
    for (const file of files) {
      try {
        const sheets = await readTableFile(file.name, new Uint8Array(await file.arrayBuffer()));
        // Every sheet with something on it is a page, in order: picture-to-Excel
        // tools often put one page per sheet (G8 review 3).
        const filled = sheets.filter(sh => sh.rows.some(r => r.some(c => String(c ?? '').trim())));
        if (!filled.length) throw new Error('empty');
        for (const sheet of filled) {
          const name = filled.length > 1 ? `${file.name} · ${sheet.name}` : file.name;
          if (tableFiles.length >= MAX_PHOTOS) { tooMany++; continue; }
          // the same page picked twice would be read twice (G8 Excel review B2)
          const key = JSON.stringify(sheet.rows);
          if (tableFiles.some(f => f.key === key)) {
            const m = MESSAGES['same-file'];
            errors.push(`⛔ ${name}: ${m.en} · ${m.th}`);
            continue;
          }
          tableFiles.push({ name, rows: sheet.rows, key });
        }
      } catch (e) {
        const m = MESSAGES[['old-xls', 'too-big', 'date-1904'].includes(e.code) ? e.code : 'not-table'];
        errors.push(`⛔ ${file.name}: ${m.en} · ${m.th}`);
      }
    }
    if (tooMany) errors.push(`⛔ ${tooMany} page(s) not added: at most ${MAX_PHOTOS} pages at a time · ` +
      `ไม่ได้เพิ่ม ${tooMany} หน้า: ได้ครั้งละไม่เกิน ${MAX_PHOTOS} หน้า`);
    tableError(errors.join('\n'));
    if (tableFiles.length && !Object.keys(tableMap).length) tableMap = findColumns(tableFiles[0].rows).map;
  } finally {
    busy = false;
    $('tablePanel').inert = false;
  }
  clearResults();          // results from before the list changed no longer match it
  drawTables();
}

// A typed balance changed after checking: the results shown were made with the old one.
for (const id of ['tableOpening', 'tableClosing']) $(id).addEventListener('input', () => clearResults());

function clearTables() {
  if (busy) return;
  clearResults();
  tableFiles = [];
  tableMap = {};
  $('tableAccount').value = '';
  $('tableClosing').value = '';
  $('tableOpening').value = '';
  $('tableSkipped').hidden = true;
  drawTables();
}

async function drawTables() {
  $('tablePanel').hidden = !tableFiles.length;
  if (!tableFiles.length) return;
  const { ROLES, ROLE_TEXT, findColumns } = await import('./table/columns.js');
  const { colLetter } = await import('./engine/output/xlsx.js');
  $('tableList').replaceChildren(...tableFiles.map((f, i) => {
    const move = (label, to, aria) => {
      const b = el('button', 'btn small', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.disabled = to < 0 || to >= tableFiles.length;
      b.addEventListener('click', () => { [tableFiles[i], tableFiles[to]] = [tableFiles[to], tableFiles[i]]; clearResults(); drawTables(); });
      return b;
    };
    const drop = el('button', 'btn small', '✕');
    drop.type = 'button';
    drop.setAttribute('aria-label', `remove ${f.name}`);
    drop.addEventListener('click', () => { tableFiles.splice(i, 1); if (i === 0) tableMap = tableFiles.length ? findColumns(tableFiles[0].rows).map : {}; clearResults(); drawTables(); });
    return el('li', '', el('span', 'name', `${i + 1}. ${f.name} (${f.rows.length} rows)`),
      move('◀', i - 1, 'move earlier'), move('▶', i + 1, 'move later'), drop);
  }));

  // The first file shows what each column holds.
  const { rows } = tableFiles[0];
  const { header } = findColumns(rows);
  const width = Math.max(0, ...rows.slice(0, 40).map(r => r.length));
  const heading = c => String((header >= 0 ? rows[header][c] : '') ?? '').trim();
  $('tableMap').replaceChildren(...ROLES.map(role => {
    const select = el('select', '');
    select.append(el('option', '', '— none · ไม่มี —'));
    select.options[0].value = '';
    for (let c = 0; c < width; c++) {
      const o = el('option', '', `${colLetter(c)}${heading(c) ? ` · ${heading(c)}` : ''}`);
      o.value = String(c);
      select.append(o);
    }
    select.value = tableMap[role] === undefined ? '' : String(tableMap[role]);
    select.addEventListener('change', () => {
      if (select.value === '') delete tableMap[role]; else tableMap[role] = Number(select.value);
      clearResults();
      drawTables();
    });
    return el('label', '', ROLE_TEXT[role], select);
  }));
  const roleAt = c => ROLES.filter(r => tableMap[r] === c).map(r => ROLE_TEXT[r].split(' · ')[0]).join(', ');
  const shown = rows.slice(Math.max(0, header), Math.max(0, header) + 7);
  $('tablePreview').replaceChildren(
    el('thead', '', el('tr', '', ...Array.from({ length: width }, (_, c) => el('th', '', colLetter(c), el('span', 'role', roleAt(c) || ' '))))),
    el('tbody', '', ...shown.map(r => el('tr', '', ...Array.from({ length: width }, (_, c) => el('td', '', String(r[c] ?? '')))))));
}

$('tableGo').addEventListener('click', async () => {
  if (busy || !tableFiles.length) return;
  const hasAmount = ['withdrawal', 'deposit', 'amount'].some(r => tableMap[r] !== undefined);
  // Without a balance typed from the original, a file whose minus signs were
  // all lost would read as a mirror image the chain cannot see (G8 re-review).
  if (!$('tableOpening').value.trim() && !$('tableClosing').value.trim()) {
    const m = MESSAGES['need-typed'];
    return tableError(`⛔ ${m.en} · ${m.th}`);
  }
  if (tableMap.balance === undefined || tableMap.date === undefined || !hasAmount) {
    const m = MESSAGES['no-balance'];
    return tableError(`⛔ ${m.en} · ${m.th}`);
  }
  busy = true;
  $('tablePanel').inert = true;
  $('tablePicker').disabled = true;
  tableError('');
  clearResults();
  try {
    const { tableStatement } = await import('./table/statement.js');
    const name = tableFiles.length === 1 ? tableFiles[0].name : `${tableFiles[0].name} (+${tableFiles.length - 1})`;
    const statement = tableStatement(name, tableFiles, tableMap, {
      account: $('tableAccount').value.replace(/\D/g, '') || null,
      closingText: $('tableClosing').value,
      openingText: $('tableOpening').value,
    });
    $('tableSkipped').hidden = !statement.skipped.length;
    $('tableSkipped').textContent = statement.skipped.length
      ? `Not read as transactions (${statement.skipped.length}): ${statement.skipped.slice(0, 8).join('; ')}${statement.skipped.length > 8 ? ' …' : ''}`
      : '';
    show([{ name, file: null, statement, error: null }]);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    const m = MESSAGES[e.code === 'bad-typed' ? 'bad-typed' : 'refused'];
    tableError(`⛔ ${m.en} · ${m.th}`);
  } finally {
    $('tablePanel').inert = false;
    $('tablePicker').disabled = false;
    busy = false;
  }
});

// ---- offline + update bar (the Pic-to-PDF pattern) ---------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js');
      reg.addEventListener('updatefound', () => {
        const fresh = reg.installing;
        if (!fresh) return;
        fresh.addEventListener('statechange', () => {
          if (fresh.state === 'installed' && navigator.serviceWorker.controller) {
            $('updatebar').hidden = false;
            $('reloadBtn').onclick = () => { fresh.postMessage('skip-waiting'); };
          }
        });
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    } catch {
      // No offline copy (e.g. a file:// preview) - the page still works online.
    }
  });
}
