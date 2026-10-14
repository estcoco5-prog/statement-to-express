// The page: pick PDFs -> read and prove each -> one Express file per account,
// a Review file per statement. Nothing is stored or sent: the files, any
// password and every result live only in this run and are dropped with it.
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { readStatement, partialRows, rowsToCheck } from './engine/statement.js';
import { StatementError } from './engine/errors.js';
import { groupBatch } from './engine/batch.js';
import { expressFiles, expressMonthFiles, reviewFileName } from './engine/output/express.js';
import { buildWorkbook } from './engine/output/review.js';
import { writeXlsx } from './engine/output/xlsx.js';
import { PROFILES } from './engine/profiles.js';
import { summarise, MESSAGES, STATUS_TEXT, UNTESTED_TEXT, PHOTO_TEXT, PARTIAL_TEXT } from './view.js';
import { photoPage, pageSizeFor, imageMatrix } from './photo/pipeline.js';
import { buildReadablePdf } from './photo/pdfwrite.js';
import { lang, setLang, onLang, pair, isPair, pick, thai, both } from './lang.js';
import { thaiSheets } from './lang-excel.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const $ = id => document.getElementById(id);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// A text given in both languages ({ en, th }) is kept, so the TH / EN switch
// can change it where it stands; a plain string is shown as it is.
const live = new Set();
function text(t) {
  const node = document.createTextNode(pick(t));
  if (isPair(t)) { node.pair = t; live.add(node); }
  return node;
}
// Build an element with plain text only - a file name is never read as HTML.
function el(tag, cls, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const c of children) node.append(c instanceof Node ? c : text(c));
  return node;
}
const setText = (node, t) => node.replaceChildren(text(t ?? ''));
const P = (en, th) => pair(en, th);
const M = code => pair(MESSAGES[code].en, MESSAGES[code].th);
// Strings and pairs joined into one pair.
const join = (...parts) => pair(parts.map(x => (isPair(x) ? x.en : String(x))).join(''),
  parts.map(x => (isPair(x) ? x.th : String(x))).join(''));
const say = t => setText($('progress'), t);

// ---- TH / EN -------------------------------------------------------------------
function applyLang(l) {
  document.documentElement.lang = l;
  document.documentElement.dataset.lang = l;
  for (const b of document.querySelectorAll('[data-set-lang]')) b.setAttribute('aria-pressed', String(b.dataset.setLang === l));
  for (const node of live) {
    if (node.isConnected) node.data = node.pair[l];
    else live.delete(node);
  }
  const pw = l === 'en' ? 'Password' : 'รหัสผ่าน';
  $('passwordInput').placeholder = pw;
  $('passwordInput').setAttribute('aria-label', pw);
}
for (const b of document.querySelectorAll('[data-set-lang]')) b.addEventListener('click', () => setLang(b.dataset.setLang));
onLang(applyLang);
applyLang(lang());

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
    say(P(`Reading ${n} of ${entries.length}: ${entry.name}`, `กำลังอ่าน ${n} จาก ${entries.length}: ${entry.name}`));
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
    say('');
    busy = false;
  }
}

// One box, naming the first locked file. Resolves with the password, or null.
function askPassword(locked) {
  const [first] = locked;
  setText($('lockedName'), P(`${first.name} is locked`, `${first.name} ล็อกด้วยรหัสผ่าน`));
  setText($('lockedMore'), locked.length > 1
    ? P(`${locked.length - 1} more locked file(s) will be tried with the same password too.`,
      `จะลองเปิดไฟล์ที่ล็อกอีก ${locked.length - 1} ไฟล์ด้วยรหัสผ่านเดียวกัน`) : '');
  const wrong = locked.some(e => e.error.code === 'wrong-password');
  $('passwordWrong').hidden = !wrong;
  setText($('passwordWrong'), M('wrong-password'));
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
  // Each file in both languages; the one saved is the page's language at the click.
  const review = s => buildWorkbook(s.rows, s.opening, s.closing, s.facts, s.checks, s.profile, s.name, s.fromPhoto);
  for (const s of statements) reviewBytes.set(s, { en: writeXlsx(review(s)), th: writeXlsx(thaiSheets(review(s))) });
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
      warnings: [...new Map([
        ...g.statements.flatMap(s => s.warnings ?? []),
        // part of the stated period with no lines at all (Co 2026-10-13: said, never refused)
        ...g.statements.flatMap(s => s.checks.filter(([label]) => label.startsWith('A month or more of the statement period has no lines'))
          .map(([, , detail]) => ({ en: `${s.name}: ${detail}`, th: `${s.name}: ${thai(detail)}` }))),
      ].map(w => [w.en, w])).values()],
      express: outs[i].fileName ? { fileName: outs[i].fileName, rows: outs[i].n } : { refused: outs[i].refused },
      reviews: g.statements.map(s => reviewFileName(s.name)),
      expressBytes: outs[i].bytes ? { en: outs[i].bytes, th: writeXlsx(thaiSheets(outs[i].sheets)) } : null,
      // the same rows, one file per month (shown when the file spans more than one)
      monthFiles: outs[i].bytes ? expressMonthFiles(g).map(m => ({ ...m, bytes: { en: m.bytes, th: writeXlsx(thaiSheets(m.sheets)) } })) : [],
      reviewBytes: g.statements.map(s => reviewBytes.get(s)),
    })),
    refusals: entries.filter(e => e.error).map(e => ({ name: e.name, ...e.error })),
  };
  const v = summarise(results);

  const t = STATUS_TEXT[v.banner];
  $('banner').className = `banner s-${v.banner}`;
  $('banner').append(text(join(t.icon, ' ', P(t.en, t.th))));
  if (v.refusals.length) {
    $('banner').append(el('span', 'th', P(`⛔ ${v.refusals.length} file(s) could not be used - see below`,
      `⛔ มี ${v.refusals.length} ไฟล์ที่ใช้ไม่ได้ - ดูด้านล่าง`)));
  }

  const fileOf = new Map(entries.map(e => [e.name, e.file]));
  for (const r of v.refusals) {
    const card = el('div', 'card refusal',
      el('h3', '', `⛔ ${r.name}`), el('p', '', P(r.en, r.th)),
      r.detail ? el('p', 'detail', pair(r.detail)) : '');
    if (r.code === 'no-text' && fileOf.has(r.name)) {
      // A scan: its pages are pictures, so read them the way photos are read.
      const b = el('button', 'btn', P('Read it as photos', 'อ่านเป็นรูปภาพ'));
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
    el('h3', '', join(pair(a.bank), ' · ', pair(a.account))),
    el('p', `status s-${a.status}`, join(t.icon, ' ', P(t.en, t.th))));
  if (a.untested) card.append(el('p', 'caveat', join('⚠ ', P(UNTESTED_TEXT.en, UNTESTED_TEXT.th))));
  if (a.photo) card.append(el('p', 'caveat', join('📷 ', P(PHOTO_TEXT.en, PHOTO_TEXT.th))));
  for (const w of g.warnings ?? []) card.append(el('p', 'caveat', join('⚠ ', P(w.en, w.th))));

  const rows = a.statements.map(s => el('tr', '',
    el('td', '', `${STATUS_TEXT[s.status].icon} ${s.name}`),
    el('td', '', pair(s.period)),
    el('td', 'num', s.rows),
    el('td', '', s.leftOut ? join(P('LEFT OUT - ', 'ตัดออก - '), pair(s.leftOut))
      : s.partial ? join('🟠 ', P(PARTIAL_TEXT.en(s.partial), PARTIAL_TEXT.th(s.partial)))
      : s.failed.length ? P(s.failed.map(([label, , detail]) => `${label}: ${detail}`).join('; '),
        s.failed.map(([label, , detail]) => `${thai(label)}: ${thai(detail)}`).join('; '))
      : P('OK', 'ผ่าน'))));
  card.append(el('div', 'table-wrap', el('table', '',
    el('thead', '', el('tr', '', el('th', '', P('Statement', 'ใบแจ้งยอด')), el('th', '', P('Period', 'งวด')),
      el('th', '', P('Rows', 'รายการ')), el('th', '', P('Result', 'ผล')))),
    el('tbody', '', ...rows))));

  if (a.checks.length) {
    card.append(el('ul', 'checks', ...a.checks.map(([label, ok, detail]) => {
      const more = detail && detail !== 'none';
      return el('li', '', P(`${ok ? '✔' : '✖'} ${label}${more ? ` - ${detail}` : ''}`,
        `${ok ? '✔' : '✖'} ${thai(label)}${more ? ` - ${thai(detail)}` : ''}`));
    })));
  }

  const dl = el('div', 'dl');
  if (a.express?.fileName) {
    dl.append(downloadButton(a.express.fileName, g.expressBytes, 'btn primary',
      (g.monthFiles ?? []).length > 1
        ? P(`⬇ Express file - whole period (${a.express.rows} rows)`, `⬇ ไฟล์ Express - ทั้งงวด (${a.express.rows} รายการ)`)
        : P(`⬇ Express file (${a.express.rows} rows)`, `⬇ ไฟล์ Express (${a.express.rows} รายการ)`)));
  } else {
    dl.append(el('p', 'bad', P(`No Express file for this account: ${a.express.refused}`,
      `บัญชีนี้ไม่มีไฟล์ Express: ${thai(a.express.refused)}`)));
  }
  if ((g.monthFiles ?? []).length > 1) {
    const months = el('div', 'months', el('span', 'sub', P('Or one Express file per month:', 'หรือแยกไฟล์ Express รายเดือน:')));
    for (const m of g.monthFiles) {
      months.append(downloadButton(m.fileName, m.bytes, 'btn small', P(`⬇ ${m.month} (${m.n} rows)`, `⬇ ${m.month} (${m.n} รายการ)`)));
    }
    dl.append(months);
  }
  a.reviews.forEach((name, i) => dl.append(downloadButton(name, g.reviewBytes[i], 'btn',
    P(`⬇ Review: ${name}`, `⬇ ไฟล์ตรวจสอบ: ${name}`))));
  card.append(dl);
  if (a.express?.fileName) {
    card.append(el('p', 'steps', el('b', '', P('Before importing: ', 'ก่อนนำเข้า: ')),
      P('1. fill every YELLOW cell (DOCNUM, BNKACC)  2. delete columns G and H (ถอน, ฝาก)',
        '1. กรอกทุกช่องสีเหลือง (DOCNUM, BNKACC)  2. ลบคอลัมน์ G และ H (ถอน, ฝาก)')));
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
  b.addEventListener('click', () => saveBytes(fileName, bytes[lang()] ?? bytes.en, XLSX));
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
  if (busy) return pictureError(P('⛔ Still working - choose the pictures again when it finishes.', '⛔ กำลังทำงานอยู่ - เลือกรูปใหม่อีกครั้งเมื่อเสร็จ'));
  await addPictures(files);
});
$('pictureClear').addEventListener('click', clearPictures);
// a different reader: the tables read before no longer stand
$('picturePassbook').addEventListener('change', () => { pictureTables = null; pictureError(''); clearResults(); drawPictures(); });

function pictureError(t) {
  $('pictureError').hidden = !t;
  setText($('pictureError'), t || '');
}

// A bank's own PDF (figures as text) is offered to Bank PDF -> Express, which
// reads it exactly; "as pictures anyway" brings it back here (Co 2026-10-13).
function offerBankPdf(files) {
  const box = $('pictureTextPdf');
  box.hidden = !files.length;
  if (!files.length) return box.replaceChildren();
  const names = files.map(f => f.name).join(', ');
  const toBank = el('button', 'btn primary small', P('Read it in Bank PDF → Express (exact)', 'อ่านด้วย PDF จากธนาคาร → Express (ตรงทุกตัว)'));
  toBank.type = 'button';
  toBank.addEventListener('click', () => { offerBankPdf([]); $('dropzone').scrollIntoView({ behavior: 'smooth' }); run(files); });
  const anyway = el('button', 'btn small', P('Read as pictures anyway', 'อ่านเป็นรูปภาพอยู่ดี'));
  anyway.type = 'button';
  anyway.addEventListener('click', () => { offerBankPdf([]); addPictures(files, { asPictures: true }); });
  box.replaceChildren(
    el('p', '', P(`ℹ ${names}: this is the bank's own PDF, with its figures as text. Bank PDF → Express reads every figure exactly - reading it as pictures can misread some.`,
      `ℹ ${names}: ไฟล์นี้เป็น PDF จากธนาคารโดยตรง ตัวเลขเป็นข้อความ ใช้ PDF จากธนาคาร → Express จะอ่านได้ตรงทุกตัว ส่วนการอ่านเป็นรูปภาพอาจอ่านตัวเลขผิดบางตัว`)),
    el('div', 'row', toBank, anyway));
}

async function addPictures(files, { asPictures = false } = {}) {
  pictureError('');
  offerBankPdf([]);
  let tooMany = 0;
  const textPdfs = [];
  for (const file of files) {
    if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      if (!asPictures) {
        const { moneyTextIn, TEXT_PDF_AT } = await import('./picture/textpdf.js');
        if (await moneyTextIn(new Uint8Array(await file.arrayBuffer()), pdfjs) >= TEXT_PDF_AT) { textPdfs.push(file); continue; }
      }
      try {
        const { picturesFromPdf } = await import('./photo/ocr.js');
        say(P(`Opening ${file.name}`, `กำลังเปิด ${file.name}`));
        const pages = await picturesFromPdf(new Uint8Array(await file.arrayBuffer()), pdfjs);
        pages.forEach((f, i) => {
          if (pictures.length >= MAX_PHOTOS) { tooMany++; return; }
          pictures.push({ file: f, name: `${file.name} #${i + 1}`, thumb: URL.createObjectURL(f) });
        });
      } catch {
        pictureError(join(`⛔ ${file.name}: `, M('not-pdf')));
      } finally {
        say('');
      }
    } else if (pictures.length >= MAX_PHOTOS) tooMany++;
    else pictures.push({ file, name: file.name, thumb: URL.createObjectURL(file) });
  }
  if (tooMany) pictureError(P(`⛔ ${tooMany} picture(s) not added: at most ${MAX_PHOTOS} at a time`,
    `⛔ ไม่ได้เพิ่ม ${tooMany} รูป: เพิ่มได้ครั้งละไม่เกิน ${MAX_PHOTOS} รูป`));
  pictureTables = null;
  clearResults();
  drawPictures();
  offerBankPdf(textPdfs);
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
  offerBankPdf([]);
  drawPictures();
}

function drawPictures() {
  $('picturePanel').hidden = !pictures.length;
  $('pictureResult').hidden = !pictureTables;
  $('pictureDone').hidden = !pictureTables;
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
    drop.setAttribute('aria-label', pick(P(`remove ${p.name}`, `ลบ ${p.name}`)));
    drop.addEventListener('click', () => { URL.revokeObjectURL(p.thumb); pictures.splice(i, 1); pictureTables = null; clearResults(); drawPictures(); });
    return el('li', '', img, el('span', 'name', `${i + 1}. ${p.name}`),
      move('◀', i - 1, pick(P('move earlier', 'เลื่อนไปก่อน'))), move('▶', i + 1, pick(P('move later', 'เลื่อนไปหลัง'))), drop);
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
    if (t.error) { box.append(el('p', 'bad', join('⛔ ', pair(t.error)))); return box; }
    const table = el('table', 'preview');
    t.rows.forEach((row, r) => {
      const tr = el('tr', '');
      const tds = [];
      const light = el(r === 0 ? 'th' : 'td', 'light', r === 0 ? P('Light', 'สถานะ') : '');
      tr.append(light);
      row.forEach((cellText, c) => {
        const td = el(r === 0 ? 'th' : 'td', '');
        td.textContent = cellText;
        td.contentEditable = 'true';
        td.spellcheck = false;
        td.addEventListener('input', () => { t.rows[r][c] = td.textContent.trim(); relightSoon(); });
        tr.append(td);
        tds.push(td);
      });
      const why = el(r === 0 ? 'th' : 'td', 'why', r === 0 ? P('Why', 'เหตุผล') : '');
      tr.append(why);
      pictureMarks[k][r] = { tr, light, why, tds };
      table.append(tr);
    });
    box.append(el('div', 'table-wrap', table));
    return box;
  }));
  relight();
}

const LIGHT_WORD = { green: P('Green', 'เขียว'), yellow: P('Yellow', 'เหลือง'), red: P('Red', 'แดง'), none: P('not a line', 'ไม่ใช่รายการ') };
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
    pictureError(join('⛔ ', M('bad-typed')));
  }
  const bar = $('pictureLight');
  $('pictureWarnings').replaceChildren(...(pictureLit?.warnings ?? []).map(w => el('p', 'caveat', join('⚠ ', P(w.en, w.th)))));
  if (!pictureLit) {
    bar.className = 'lightbar red';
    bar.replaceChildren(el('span', '', P('Fix the typed balance to see the lights', 'แก้ยอดที่กรอกไว้ให้ถูกรูปแบบ แล้วสีไฟจะแสดง')));
  } else {
    const { light, headline, counts } = pictureLit.set;
    const dot = el('span', `dot ${light}`);
    bar.className = `lightbar ${light}`;
    const total = counts.green + counts.yellow + counts.red;
    bar.replaceChildren(el('span', '', dot, join(' ', LIGHT_WORD[light], ': ', pair(headline))),
      el('span', 'counts', P(`${total} lines · ${counts.green} green · ${counts.yellow} yellow · ${counts.red} red`,
        `${total} บรรทัด · เขียว ${counts.green} · เหลือง ${counts.yellow} · แดง ${counts.red}`)));
    $('pictureChecks').replaceChildren(...pictureLit.checks.map(c =>
      el('li', c.passed ? '' : 'fail', P(`${c.passed ? '✔' : '✘'} ${c.label}${c.detail ? ` - ${c.detail}` : ''}`,
        `${c.passed ? '✔' : '✘'} ${thai(c.label)}${c.detail ? ` - ${thai(c.detail)}` : ''}`))));
  }
  pictureMarks.forEach((marks, k) => marks.forEach((m, r) => {
    if (r === 0) return;
    const l = pictureLit?.rows[k]?.[r] ?? null;
    m.tr.className = l ? l.light : '';
    const dot = el('span', `dot ${l?.light ?? 'none'}`);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', l ? pick(LIGHT_WORD[l.light]) : pick(P('not checked', 'ยังไม่ได้ตรวจ')));
    m.light.replaceChildren(dot);
    setText(m.why, l?.why ? pair(l.why) : '');
    // a figure the balance agrees with, offered: only this tap puts it in
    for (const f of l?.fixes ?? []) {
      const use = el('button', 'btn small', P(`Use ${f.to}`, `ใช้ ${f.to}`));
      use.type = 'button';
      use.addEventListener('click', () => {
        pictureTables[k].rows[r][f.c] = f.to;
        if (m.tds[f.c]) m.tds[f.c].textContent = f.to;
        relightSoon();
      });
      m.why.append(' ', use);
    }
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
      say(P(`Reading picture ${i + 1} of ${pictures.length}`, `กำลังอ่านรูปที่ ${i + 1} จาก ${pictures.length}`));
      try {
        const { size, ocrWords } = await readPhoto(p.file, s => say(both(s)));
        const t = pictureTable(ocrWords, size);
        tables.push(t.ok ? { name: p.name, ...t } : { name: p.name, error: t.reason, rows: [], other: [] });
      } catch (e) {
        const m = MESSAGES[e instanceof PhotoError && MESSAGES[e.code] ? e.code : 'not-image'];
        tables.push({ name: p.name, error: m.en, rows: [], other: [] });   // shown in Thai by lang.js
      }
    }
    pictureTables = tables;
  } catch (e) {
    console.error(e);
    pictureError(join('⛔ ', M('refused')));
  } finally {
    say('');
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
    say(P(`Opening page ${i + 1} of ${pictures.length}`, `กำลังเปิดหน้า ${i + 1} จาก ${pictures.length}`));
    let canvas;
    try {
      canvas = await decodeUpright(p.file);
    } catch {
      pictureError(join(`⛔ ${p.name}: `, M('not-image')));
      return null;
    }
    grey.push(greyFromRGBA(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height));
  }
  const lines = await readPassbook(grey, KTB_PASSBOOK, ({ step, page, pages }) => {
    say(readStep(step, page, pages));
  });
  if (!lines.some(l => l.balance)) {
    pictureError(join('⛔ ', M('not-passbook')));
    return null;
  }
  return passbookTables(lines, pictures.map(p => p.name));
}

// The passbook reader reads every page, then once more with the dots it learned.
const readStep = (step, page, pages) => (step === 'reread'
  ? P(`Reading again with what it learned: page ${page} of ${pages}`, `กำลังอ่านซ้ำด้วยรูปแบบที่เรียนรู้: หน้า ${page} จาก ${pages}`)
  : P(`Reading page ${page} of ${pages}`, `กำลังอ่านหน้า ${page} จาก ${pages}`));

$('pictureDownload').addEventListener('click', async () => {
  if (!pictureTables) return;
  const { pictureWorkbook } = await import('./picture/excel.js');
  if (!pictureTables.some(t => !t.error)) return pictureError(P('⛔ No table was read from these pictures.', '⛔ ไม่มีตารางที่อ่านได้จากรูปชุดนี้'));
  await relight();          // the lights saved are the ones for the cells as they stand
  const stamp = new Date().toISOString().slice(0, 10);
  saveBytes(`${stamp} statement pictures.xlsx`, pictureWorkbook(pictureTables, pictureLit,
    { openingText: $('pictureOpening').value.trim(), closingText: $('pictureClosing').value.trim() }, lang()), XLSX);
});

$('pictureAccount').addEventListener('input', () => clearResults());

// Convert to Express: only when pressed. The tables as they stand (fixes
// included) are checked once more and shown like the Excel card's result:
// proved lines go to Express, the rest to Rows to check.
$('pictureExpress').addEventListener('click', async () => {
  if (busy || !pictureTables) return;
  const unread = pictureTables.map((t, k) => (t.error || !t.rows?.length ? `${k + 1}. ${t.name}` : null)).filter(Boolean);
  if (unread.length) {
    return pictureError(P(`⛔ Not read: ${unread.join(', ')}. Remove or retake ${unread.length === 1 ? 'it' : 'them'} first, so no page is missing from Express.`,
      `⛔ อ่านไม่ได้: ${unread.join(', ')} ลบออกหรือถ่ายใหม่ก่อน เพื่อไม่ให้ไฟล์ Express ขาดหน้าใดไป`));
  }
  // Without a balance typed from the paper, a reading whose minus signs were
  // all lost is a mirror image the chain cannot see (as the Excel card).
  if (!$('pictureOpening').value.trim() && !$('pictureClosing').value.trim()) {
    return pictureError(join('⛔ ', M('need-typed')));
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
    pictureError(join('⛔ ', M(e.code === 'bad-typed' ? 'bad-typed' : 'refused')));
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

function photoError(t) {
  $('photoError').hidden = !t;
  setText($('photoError'), t || '');
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
    drop.setAttribute('aria-label', pick(P(`remove ${p.name}`, `ลบ ${p.name}`)));
    drop.addEventListener('click', () => { URL.revokeObjectURL(p.thumb); photos.splice(i, 1); photoPdf = null; drawPhotos(); });
    return el('li', '', img, el('span', 'name', `${i + 1}. ${p.name}`),
      move('◀', i - 1, pick(P('move earlier', 'เลื่อนไปก่อน'))), move('▶', i + 1, pick(P('move later', 'เลื่อนไปหลัง'))), drop);
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
      say(P(`Reading photo ${i + 1} of ${photos.length}: ${p.name}`, `กำลังอ่านรูปที่ ${i + 1} จาก ${photos.length}: ${p.name}`));
      let read;
      try {
        read = await readPhoto(p.file, s => say(both(s)));
      } catch (e) {
        return photoError(join(`⛔ ${p.name}: `, M(MESSAGES[e.code] ? e.code : 'refused')));
      }
      const page = photoPage(read.ocrWords, read.size);
      if (!page.ok) return photoError(join(`⛔ ${p.name}: `, M(page.code)));
      const { width, height } = pageSizeFor(page.bank);
      if (pages.length && pages[0].bank !== page.bank) return photoError(join(`⛔ ${p.name}: `, M('mixed-banks')));
      pages.push({ jpeg: read.jpeg, width, height, words: page.words, bank: page.bank, summary: !!page.summary,
        imageMatrix: imageMatrix(page.placement, read.size.w, read.size.h, height) });
    }
    const summaryPages = pages.flatMap((pg, i) => pg.summary ? [i] : []);
    if (summaryPages.length === pages.length) {
      return photoError(join('⛔ ', M('summary-only')));
    }
    photoPdf = buildReadablePdf(pages, { bank: pages[0].bank, summaryPages });
    drawPhotos();
  } catch (e) {
    console.error(e);
    photoError(join('⛔ ', M('refused')));
  } finally {
    say('');
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

function passbookError(t) {
  $('passbookError').hidden = !t;
  setText($('passbookError'), t || '');
}

async function addPassbookFiles(files) {
  passbookError('');
  for (const file of files) {
    if (passbookPages.length >= MAX_PHOTOS) break;
    if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      try {
        const { picturesFromPdf } = await import('./photo/ocr.js');
        say(P(`Opening ${file.name}`, `กำลังเปิด ${file.name}`));
        const pages = await picturesFromPdf(new Uint8Array(await file.arrayBuffer()), pdfjs);
        pages.forEach((f, i) => passbookPages.push({ file: f, name: `${file.name} #${i + 1}`, thumb: URL.createObjectURL(f) }));
      } catch {
        passbookError(join(`⛔ ${file.name}: `, M('not-pdf')));
      } finally {
        say('');
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
    drop.setAttribute('aria-label', pick(P(`remove ${p.name}`, `ลบ ${p.name}`)));
    drop.addEventListener('click', () => { URL.revokeObjectURL(p.thumb); passbookPages.splice(i, 1); drawPassbook(); });
    return el('li', '', img, el('span', 'name', `${i + 1}. ${p.name}`),
      move('◀', i - 1, pick(P('move earlier', 'เลื่อนไปก่อน'))), move('▶', i + 1, pick(P('move later', 'เลื่อนไปหลัง'))), drop);
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
      say(P(`Opening page ${i + 1} of ${passbookPages.length}`, `กำลังเปิดหน้า ${i + 1} จาก ${passbookPages.length}`));
      let canvas;
      try {
        canvas = await decodeUpright(p.file);
      } catch {
        return passbookError(join(`⛔ ${p.name}: `, M('not-image')));
      }
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      pictures.push(greyFromRGBA(data, canvas.width, canvas.height));
    }
    const lines = await readPassbook(pictures, KTB_PASSBOOK, ({ step, page, pages }) => {
      say(readStep(step, page, pages));
    });
    pictures.length = 0;
    if (!lines.some(l => l.balance)) {
      return passbookError(join('⛔ ', M('not-passbook')));
    }
    const statement = passbookStatement('Passbook.pdf', lines, KTB_PASSBOOK,
      { account: $('passbookAccount').value.replace(/\D/g, '') || null });
    show([{ name: 'Passbook.pdf', file: null, statement, error: null }]);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    passbookError(join('⛔ ', M('refused')));
  } finally {
    say('');
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
  if (busy) return tableError(P('⛔ Still working - choose the files again when it finishes.', '⛔ กำลังทำงานอยู่ - เลือกไฟล์ใหม่อีกครั้งเมื่อเสร็จ'));
  await addTables(files);
});
$('tableClear').addEventListener('click', clearTables);

function tableError(t) {
  $('tableError').hidden = !t;
  setText($('tableError'), t || '');
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
            errors.push(join(`⛔ ${name}: `, M('same-file')));
            continue;
          }
          tableFiles.push({ name, rows: sheet.rows, key });
        }
      } catch (e) {
        errors.push(join(`⛔ ${file.name}: `, M(['old-xls', 'too-big', 'date-1904', 'own-picture-file'].includes(e.code) ? e.code : 'not-table')));
      }
    }
    if (tooMany) errors.push(P(`⛔ ${tooMany} page(s) not added: at most ${MAX_PHOTOS} pages at a time`,
      `⛔ ไม่ได้เพิ่ม ${tooMany} หน้า: เพิ่มได้ครั้งละไม่เกิน ${MAX_PHOTOS} หน้า`));
    tableError(errors.length ? join(...errors.flatMap((e, i) => (i ? ['\n', e] : [e]))) : '');
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
    drop.setAttribute('aria-label', pick(P(`remove ${f.name}`, `ลบ ${f.name}`)));
    drop.addEventListener('click', () => { tableFiles.splice(i, 1); if (i === 0) tableMap = tableFiles.length ? findColumns(tableFiles[0].rows).map : {}; clearResults(); drawTables(); });
    return el('li', '', el('span', 'name', P(`${i + 1}. ${f.name} (${f.rows.length} rows)`, `${i + 1}. ${f.name} (${f.rows.length} แถว)`)),
      move('◀', i - 1, pick(P('move earlier', 'เลื่อนไปก่อน'))), move('▶', i + 1, pick(P('move later', 'เลื่อนไปหลัง'))), drop);
  }));

  // The first file shows what each column holds.
  const { rows } = tableFiles[0];
  const { header } = findColumns(rows);
  const width = Math.max(0, ...rows.slice(0, 40).map(r => r.length));
  const heading = c => String((header >= 0 ? rows[header][c] : '') ?? '').trim();
  $('tableMap').replaceChildren(...ROLES.map(role => {
    const select = el('select', '');
    select.append(el('option', '', P('— none —', '— ไม่มี —')));
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
    return el('label', '', both(ROLE_TEXT[role]), select);
  }));
  const roleAt = c => join(...ROLES.filter(r => tableMap[r] === c).map((r, i) => join(i ? ', ' : '', both(ROLE_TEXT[r]))));
  const shown = rows.slice(Math.max(0, header), Math.max(0, header) + 7);
  $('tablePreview').replaceChildren(
    el('thead', '', el('tr', '', ...Array.from({ length: width }, (_, c) => el('th', '', colLetter(c), el('span', 'role', roleAt(c).en ? roleAt(c) : ' '))))),
    el('tbody', '', ...shown.map(r => el('tr', '', ...Array.from({ length: width }, (_, c) => el('td', '', String(r[c] ?? '')))))));
}

$('tableGo').addEventListener('click', async () => {
  if (busy || !tableFiles.length) return;
  const hasAmount = ['withdrawal', 'deposit', 'amount'].some(r => tableMap[r] !== undefined);
  // Without a balance typed from the original, a file whose minus signs were
  // all lost would read as a mirror image the chain cannot see (G8 re-review).
  if (!$('tableOpening').value.trim() && !$('tableClosing').value.trim()) {
    return tableError(join('⛔ ', M('need-typed')));
  }
  if (tableMap.balance === undefined || tableMap.date === undefined || !hasAmount) {
    return tableError(join('⛔ ', M('no-balance')));
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
    const shownSkips = statement.skipped.slice(0, 8).join('; ') + (statement.skipped.length > 8 ? ' …' : '');
    setText($('tableSkipped'), statement.skipped.length
      ? P(`Not read as transactions (${statement.skipped.length}): ${shownSkips}`,
        `ไม่นับเป็นรายการ (${statement.skipped.length}): ${thai(shownSkips)}`)
      : '');
    show([{ name, file: null, statement, error: null }]);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    tableError(join('⛔ ', M(e.code === 'bad-typed' ? 'bad-typed' : 'refused')));
  } finally {
    $('tablePanel').inert = false;
    $('tablePicker').disabled = false;
    busy = false;
  }
});

// ---- layout D (Co 2026-10-14): with files chosen, the tool cards shrink to a
// slim row and the box that opens is scrolled into view; its buttons are pinned
// (styles.css .actions). Nothing here changes what any tool does.
const BOXES = { picturePanel: 'pictureTool', photoPanel: 'photoTool', passbookPanel: 'passbookTool',
  tablePanel: 'tableTool', passwordPanel: 'dropzone', results: null };
const shown = new Set();
function relayout() {
  let opened = null;
  for (const [box, tool] of Object.entries(BOXES)) {
    const on = !$(box).hidden;
    if (on && !shown.has(box)) opened = box;
    if (on) shown.add(box); else shown.delete(box);
    if (tool) $(tool).classList.toggle('on', on && box !== 'passwordPanel');
  }
  document.body.classList.toggle('focus', shown.size > 0);
  for (const tool of slimTools) {
    if (shown.size) { tool.tabIndex = 0; tool.setAttribute('role', 'button'); } else { tool.removeAttribute('tabindex'); tool.removeAttribute('role'); }
  }
  // a box (or the results) that has just opened is brought up, just under the slim row
  if (opened) requestAnimationFrame(() => {
    const tools = document.querySelector('.tools');
    const top = $(opened).getBoundingClientRect().top + window.scrollY - tools.offsetHeight - 24;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  });
}
const slimTools = document.querySelectorAll('.tools .tool:not(.link)');
const watch = new MutationObserver(relayout);
for (const box of Object.keys(BOXES)) watch.observe($(box), { attributes: true, attributeFilter: ['hidden'] });
// the box title says how many pages it holds
for (const [list, th, en] of [['pictureList', 'รูป', 'pictures'], ['photoList', 'รูป', 'photos'], ['passbookList', 'หน้า', 'pages'], ['tableList', 'ไฟล์', 'files']]) {
  const title = $(list).closest('.panel').querySelector('h2');
  const count = () => {
    const n = $(list).children.length;
    if (n) { title.dataset.countTh = `${n} ${th}`; title.dataset.countEn = `${n} ${n === 1 ? en.replace(/s$/, '') : en}`; }
    else { delete title.dataset.countTh; delete title.dataset.countEn; }
  };
  new MutationObserver(count).observe($(list), { childList: true });
}
// a slim card opens its own file picker
for (const tool of slimTools) {
  const open = e => {
    if (!document.body.classList.contains('focus') || e.target.closest('label, input, button, a, .caveat')) return;
    e.preventDefault();
    tool.querySelector('input[type=file]')?.click();
  };
  tool.addEventListener('click', open);
  tool.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(e); });
}

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
