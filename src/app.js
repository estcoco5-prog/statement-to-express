// The page: pick PDFs -> read and prove each -> one Express file per account,
// a Review file per statement. Nothing is stored or sent: the files, any
// password and every result live only in this run and are dropped with it.
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { readStatement } from './engine/statement.js';
import { StatementError } from './engine/errors.js';
import { groupBatch } from './engine/batch.js';
import { expressFiles, reviewFileName } from './engine/output/express.js';
import { buildWorkbook } from './engine/output/review.js';
import { writeXlsx } from './engine/output/xlsx.js';
import { PROFILES } from './engine/profiles.js';
import { summarise, MESSAGES, STATUS_TEXT, UNTESTED_TEXT } from './view.js';

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

$('againBtn').addEventListener('click', () => { clearResults(); window.scrollTo(0, 0); });

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
    reviewBytes.set(s, writeXlsx(buildWorkbook(s.rows, s.opening, s.closing, s.facts, s.checks, s.profile, s.name)));
  }
  const results = {
    groups: groups.map((g, i) => ({
      bank: g.profile.bank,
      account: g.account,
      untested: g.profile.untested,
      statuses: g.statements.map(s => g.status(s)),
      statements: g.statements.map(s => ({
        name: s.name, period: period(s), rows: s.rows.length, status: g.status(s),
        leftOut: g.leftOutReason(s), failed: s.checks.filter(([, ok]) => !ok),
      })),
      checks: g.checks,
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

  for (const r of v.refusals) {
    $('refusals').append(el('div', 'card refusal',
      el('h3', '', `⛔ ${r.name}`), el('p', '', r.en), el('p', 'sub', r.th),
      r.detail ? el('p', 'detail', r.detail) : ''));
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

  const rows = a.statements.map(s => el('tr', '',
    el('td', '', `${STATUS_TEXT[s.status].icon} ${s.name}`),
    el('td', '', s.period),
    el('td', 'num', s.rows),
    el('td', '', s.leftOut ? `LEFT OUT - ${s.leftOut}`
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

function downloadButton(fileName, bytes, cls, label) {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([bytes], { type: XLSX }));
    const a = el('a', '');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);   // after the browser has taken it
  });
  return b;
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
