// The release gate: the JS engine must give the SAME answers as the private
// reference implementation on real statements.
//
//   node tools/compare-oracle.mjs <samples.json> <oracle_dir> [<express_template.xlsx>]
//
// <samples.json> lists real PDFs (paths relative to that file) and passwords;
// <oracle_dir> holds the reference answers (result.json + xlsx files per case).
// Both live OUTSIDE this repository and are never committed. Hard gates:
// result.json deep-equal, every XML part of every workbook equal as text, and
// (given the template) Express rows 1-3 equal to the template's own.
// Exit 0 only if every case passes.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pdfjs from '../tests/pdfjs.js';
import { readStatement, statusOf } from '../src/engine/statement.js';
import { groupBatch } from '../src/engine/batch.js';
import { buildWorkbook } from '../src/engine/output/review.js';
import { expressFiles, reviewFileName, buildBktrn } from '../src/engine/output/express.js';
import { workbookParts } from '../src/engine/output/xlsx.js';
import { fmtMoney } from '../src/engine/money.js';
import { StatementError } from '../src/engine/errors.js';

const [samplesPath, oracleDir, templatePath] = process.argv.slice(2);
if (!samplesPath || !oracleDir) {
  console.error('usage: node tools/compare-oracle.mjs <samples.json> <oracle_dir> [<express_template.xlsx>]');
  process.exit(2);
}
const base = path.dirname(path.resolve(samplesPath));
const { cases } = JSON.parse(fs.readFileSync(samplesPath, 'utf8'));

const m = v => (v === null || v === undefined ? null : fmtMoney(v));
const MONEY_FACTS = new Set(['closing_stated', 'withdraw_total', 'deposit_total']);

function factsJson(facts) {
  const out = {};
  for (const [k, v] of Object.entries(facts)) out[k] = MONEY_FACTS.has(k) ? m(v) : v;
  return out;
}

const rowJson = r => ({ date: r.date, time: r.time, description: r.description, channel: r.channel,
  details: r.details, amount: m(r.amount), balance: m(r.balance), withdrawal: m(r.withdrawal),
  deposit: m(r.deposit), notes: [...r.notes], verified: r.verified });

function unzip(file) {
  const buf = fs.readFileSync(file);
  const out = {};
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

// The first difference between two JSON-able values, as a path + both sides.
function firstDiff(a, b, where = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${where}.${k}`);
      if (d) return d;
    }
  }
  return `${where}: js=${JSON.stringify(a)?.slice(0, 160)} | ref=${JSON.stringify(b)?.slice(0, 160)}`;
}

function compareParts(jsSheets, refFile) {
  const ref = unzip(refFile);
  const js = Object.fromEntries(workbookParts(jsSheets).map(p => [p.name, p.text]));
  const names = [...new Set([...Object.keys(ref), ...Object.keys(js)])].sort();
  for (const name of names) {
    if (js[name] !== ref[name]) {
      const a = js[name] ?? '(missing)', b = ref[name] ?? '(missing)';
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      return `${path.basename(refFile)} ${name} @${i}: js=…${a.slice(Math.max(0, i - 60), i + 80)}… | ref=…${b.slice(Math.max(0, i - 60), i + 80)}…`;
    }
  }
  return null;
}

let failed = 0;
for (const c of cases) {
  const refDir = path.join(oracleDir, c.name);
  const ref = JSON.parse(fs.readFileSync(path.join(refDir, 'result.json'), 'utf8'));
  const statements = [], refused = [];
  for (const rel of c.files) {
    const file = path.join(base, rel);
    const name = path.basename(file);
    try {
      statements.push(await readStatement(name, new Uint8Array(fs.readFileSync(file)), c.passwords, c.bank ?? null, pdfjs));
    } catch (e) {
      if (!(e instanceof StatementError)) throw e;
      refused.push({ name, error: e.message.split('\n')[0] });
    }
  }
  const groups = groupBatch(statements);
  const result = {
    statements: statements.map(s => ({ name: s.name, bank: s.profile.key, facts: factsJson(s.facts),
      opening: m(s.opening), closing: m(s.closing), rows: s.rows.map(rowJson),
      checks: s.checks, status: statusOf(s) })),
    refused,
    groups: groups.map(g => ({ bank: g.profile.key, account: g.account, checks: g.checks,
      statuses: g.statements.map(s => g.status(s)),
      left_out: g.excluded().map(s => ({ name: s.name, reason: g.leftOutReason(s) })),
      express_rows: g.expressRows().length, express_file: null })),
  };
  const outputs = expressFiles(groups);
  outputs.forEach((o, i) => { result.groups[i].express_file = o.fileName ?? null; });

  const problems = [];
  const d = firstDiff(result, ref, 'result');
  if (d) problems.push(d);
  if (!d) {
    for (const s of statements) {
      const sheets = buildWorkbook(s.rows, s.opening, s.closing, s.facts, s.checks, s.profile, s.name);
      const p = compareParts(sheets, path.join(refDir, 'review', reviewFileName(s.name)));
      if (p) { problems.push(p); break; }
    }
    for (const o of outputs) {
      if (!o.fileName) continue;
      const p = compareParts(o.sheets, path.join(refDir, 'express', o.fileName));
      if (p) { problems.push(p); break; }
    }
  }
  const rows = statements.reduce((a, s) => a + s.rows.length, 0);
  if (problems.length) {
    failed++;
    console.log(`FAIL  ${c.name.padEnd(24)} ${problems[0]}`);
  } else {
    console.log(`PASS  ${c.name.padEnd(24)} ${statements.length} statement(s), ${rows} rows, ${outputs.filter(o => o.fileName).length} Express file(s) identical`);
  }
}
// Rows 1-3, columns A-F, must hold exactly the values Express's own ฝาก-ถอนเงิน
// template holds (a port of the answer key's template test). Cells are read in
// order, shared strings resolved, as the answer key reads them.
if (templatePath) {
  const unescape = s => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]);
  const grid = parts => {
    const shared = [...(parts['xl/sharedStrings.xml'] ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map(([, si]) => [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unescape(t[1])).join(''));
    return [...parts['xl/worksheets/sheet1.xml'].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(([, row]) =>
      [...row.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, body = '']) => {
        const inline = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(body);
        if (inline) return unescape(inline[1]);
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (!v) return '';
        return /t="s"/.test(attrs) ? shared[Number(v[1])] : unescape(v[1]);
      }));
  };
  const template = unzip(templatePath);
  const theirs = grid(template);
  const ours = grid(Object.fromEntries(workbookParts([buildBktrn([], [])]).map(p => [p.name, p.text])));
  let ok = true;
  ['the Thai label row', 'the length-limit row', 'the Field row'].forEach((name, i) => {
    const mine = ours[i].slice(0, 6), yours = theirs[i].slice(0, 6);
    if (JSON.stringify(mine) !== JSON.stringify(yours)) {
      ok = false;
      console.log(`FAIL  template row ${i + 1} (${name}): ours=${JSON.stringify(mine)} | template=${JSON.stringify(yours)}`);
    }
  });
  if (!('xl/tables/table1.xml' in template)) {
    ok = false;
    console.log('FAIL  the template no longer puts a table on its data sheet');
  }
  if (ok) console.log(`PASS  ${'template'.padEnd(24)} rows 1-3 (A-F) identical to the Express template`);
  else failed++;
}

console.log(failed ? `\n${failed} check(s) differ from the reference.` : '\nEvery case is identical to the reference.');
process.exit(failed ? 1 : 0);
