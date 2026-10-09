// The private Picture -> Excel gate: zero silent wrong numbers.
//
//   node tools/picture-gate.mjs <dir of words .json from tools/ocr-dump.mjs>
//
// For each page the photo reader read: build the table (src/picture/table.js),
// check it as the Excel card does (opening typed from the bank PDF), and
// compare with the same statement read from its bank PDF:
//   rows right   table lines whose date, amount and balance all match the PDF
//   green        rows the checks prove - every one MUST match the PDF
//   cells        each line's date, amount and balance on its own: the right
//                details matter, not only proved lines (Co, 2026-10-09)
// A green row that does not match is SILENT WRONG, the one failure forbidden.
import fs from 'node:fs';
import path from 'node:path';
import pdfjs from '../tests/pdfjs.js';
import { pictureTable } from '../src/picture/table.js';
import { findColumns } from '../src/table/columns.js';
import { tableStatement } from '../src/table/statement.js';
import { readStatement, partialRows, statusOf } from '../src/engine/statement.js';
import { fmtMoney } from '../src/engine/money.js';
import { pictureLights } from '../src/picture/lights.js';

const dir = process.argv[2];
const truths = new Map();
const key = (date, amount, balance) => `${date}|${amount}|${balance}`;
let silent = 0;
const totals = { cells: 0, of: 0 };
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && (!process.env.ONLY || process.env.ONLY.split(',').some(o => f.startsWith(`${o}-`)))).sort();
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!truths.has(d.pdf)) truths.set(d.pdf, await readStatement('t.pdf', new Uint8Array(fs.readFileSync(d.pdf)), d.passwords, null, pdfjs));
  const truth = truths.get(d.pdf);
  const real = new Set(truth.rows.map(r => key(r.date, r.withdrawal ?? r.deposit, r.balance)));
  const name = f.replace(/\.json$/, '').padEnd(26);
  const t = pictureTable(d.words, { w: d.w, h: d.h });
  if (!t.ok) { console.log(`${name} ⛔ refused: ${t.code}`); continue; }
  const map = process.env.FIND ? findColumns(t.rows).map : t.map;
  if (process.env.SHOW && f.startsWith(process.env.SHOW)) {
    console.log(t.rows.map(r => r.join(' | ')).join('\n'));
    console.log('map', map);
  }
  let s, closing = '';
  try {
    // The person types the opening and the closing printed on this page (the
    // balance of its last real line, from the PDF).
    // the page's closing: the last PDF line whose date, amount and balance the table holds
    const first = tableStatement(f, [{ name: f, rows: t.rows, dayFirst: t.dayFirst }], map, { openingText: fmtMoney(truth.opening) });
    // the last table line that matches a PDF line, then as many PDF lines on as the table has after it
    const tkey = r => key(r.date, r.withdrawal ?? r.deposit, r.balance);
    let lastOnPage = null;
    for (let j = first.rows.length - 1; j >= 0 && !lastOnPage; j--) {
      const k = truth.rows.findIndex(r => tkey(r) === key(first.rows[j].date, first.rows[j].amount, first.rows[j].balance));
      if (k >= 0) lastOnPage = truth.rows[Math.min(truth.rows.length - 1, k + first.rows.length - 1 - j)];
    }
    closing = lastOnPage ? fmtMoney(lastOnPage.balance) : '';
    s = tableStatement(f, [{ name: f, rows: t.rows, dayFirst: t.dayFirst }], map, { openingText: fmtMoney(truth.opening), closingText: process.env.NO_CLOSING ? '' : closing });
    if (process.env.LOOSE) delete s.linkedRows;
  } catch (e) { console.log(`${name} ⛔ ${e.message}`); continue; }
  const right = s.rows.filter(r => real.has(key(r.date, r.amount, r.balance))).length;
  const green = partialRows(s) ?? (statusOf(s) !== 'red' ? s.rows : []);
  const wrong = green.filter(r => !real.has(key(r.date, r.amount, r.balance)));
  silent += wrong.length;
  // The traffic lights the person sees: every GREEN row must match the PDF too.
  const lit = pictureLights([{ name: f, ...t }], { openingText: fmtMoney(truth.opening), closingText: process.env.NO_CLOSING ? '' : closing });
  const lights = lit.rows[0].filter(x => x && x.light !== 'none');
  const greenLit = lights.filter(x => x.light === 'green').map(x => lit.statement.rows[x.at]);
  const wrongLit = greenLit.filter(r => !real.has(key(r.date, r.amount, r.balance)));
  silent += wrongLit.length;
  for (const r of wrongLit) console.log(`    wrong GREEN LIGHT: ${r.date} ${r.amount} ${r.balance}`);
  // Cell by cell: each line is matched to a PDF line by its balance (or, if
  // the balance was misread, by its date and amount), then each cell is scored.
  const used = new Set();
  let cells = 0;
  for (const r of s.rows) {
    const amountOf = x => x.withdrawal ?? x.deposit;
    let k = truth.rows.findIndex((x, j) => !used.has(j) && x.balance === r.balance);
    if (k < 0) k = truth.rows.findIndex((x, j) => !used.has(j) && x.date === r.date && amountOf(x) === r.amount);
    if (k < 0) continue;
    used.add(k);
    const x = truth.rows[k];
    cells += (x.date === r.date) + (amountOf(x) === r.amount) + (x.balance === r.balance);
  }
  totals.cells += cells; totals.of += 3 * s.rows.length;
  const tally = ['green', 'yellow', 'red'].map(c => `${lights.filter(x => x.light === c).length}${c[0].toUpperCase()}`).join('/');
  const roles = ['date', 'withdrawal', 'deposit', 'amount', 'balance'].filter(r => map[r] !== undefined).join(',');
  console.log(`${name} ${wrong.length ? '❌ SILENT WRONG' : '✔'} ${s.rows.length} lines, ${right} right, ${green.length} green` +
    ` | cells ${cells}/${3 * s.rows.length} | lights ${tally} set ${lit.set.light}${wrongLit.length ? ' ❌' : ''} | cols ${t.columns} heading ${t.headingFound ? 'yes' : 'NO'} [${roles}]`);
  for (const r of wrong) console.log(`    wrong green: ${r.date} ${r.amount} ${r.balance}`);
  if (process.env.WHY && f.startsWith(process.env.WHY)) {
    console.log('    dayFirst on page:', t.dayFirst);
    for (const [label, ok, detail] of s.checks) if (!ok) console.log(`    FAIL ${label}: ${String(detail).slice(0, 150)}`);
    const notes = {}; for (const r of s.rows) for (const n of r.notes) { const k = n.replace(/\d[\d,./-]*/g, '#').slice(0, 70); notes[k] = (notes[k] ?? 0) + 1; }
    console.log(notes);
  }
}
console.log(`\ncells right, all pages: ${totals.cells}/${totals.of}`);
console.log(silent ? `\nGATE FAILED: ${silent} silent wrong` : '\nGATE PASSED: zero silent wrong');
process.exit(silent ? 1 : 0);
