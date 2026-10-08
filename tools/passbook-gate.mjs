// The private passbook gate: read a passbook scan with the app's own reader
// and engine, and compare every line with what a person read.
//
//   node tools/passbook-gate.mjs <pages dir with p1.pgm ...> <answer.json>
//
// <answer.json>: [[[date, amount, balance], ...] per page]. Both stay outside
// the repository. The rule: no amount or balance the chain proves may differ.
import fs from 'node:fs';
import path from 'node:path';
import { readPassbook } from '../src/passbook/reader.js';
import { KTB_PASSBOOK } from '../src/passbook/printers/ktb.js';
import { passbookStatement } from '../src/passbook/statement.js';
import { statusOf, partialRows, rowsToCheck } from '../src/engine/statement.js';
import { groupBatch } from '../src/engine/batch.js';
import { expressFiles } from '../src/engine/output/express.js';
import { cents } from '../src/passbook/reader.js';
import { passbookDate } from '../src/passbook/statement.js';

const [dir, answerPath] = process.argv.slice(2);
const answer = JSON.parse(fs.readFileSync(answerPath, 'utf8'));
const pgm = f => {
  const buf = fs.readFileSync(f);
  const head = buf.toString('latin1', 0, 40).match(/^P5\s+(\d+)\s+(\d+)\s+255\s/);
  return { w: +head[1], h: +head[2], px: new Uint8Array(buf.subarray(head[0].length)) };
};
const pictures = answer.map((_, i) => pgm(path.join(dir, `p${i + 1}.pgm`)));
const t0 = Date.now();
const lines = await readPassbook(pictures, KTB_PASSBOOK);
const secs = (Date.now() - t0) / 1000;
let right = 0, money = 0;
if (process.env.MARGINS) for (const l of lines) { const w = answer[l.page - 1]?.[l.line - 1]; console.log(`margin ${l.dateMargin?.toFixed(3)} ${l.date === w?.[0] ? 'right' : 'WRONG'} p${l.page} l${l.line}`); }
for (const l of lines) {
  const want = answer[l.page - 1]?.[l.line - 1];
  const m = want && (l.amount ?? '') === want[1] && l.balance === want[2];
  if (m) money++;
  if (m && l.date === want[0]) right++;
  else if (process.env.SHOW) console.log(`p${l.page} l${l.line} read ${l.date} ${l.amount} ${l.balance} | want ${want?.join(' ')}`);
}
const total = answer.flat().length;
console.log(`${lines.length} lines read (${total} printed) | money right ${money} | all right ${right} | ${secs.toFixed(1)} s`);

// ---- the engine: proof, partial, Express ----
const st = passbookStatement('passbook.pdf', lines, KTB_PASSBOOK, { account: '000-0-00000-0' });
const [group] = groupBatch([st]);
const [out] = expressFiles([group]);
const toExpress = group.expressRows();
const toCheck = group.isPartial(st) ? rowsToCheck(st) : [];
let silent = 0, dateWrong = 0;
for (const r of toExpress) {
  const want = answer[r.page - 1][r.line - 1];
  const signedWant = (want[1][0] === '-' ? -1 : 1) * cents(want[1]);
  const got = r.deposit !== null ? r.deposit : -r.withdrawal;
  if (got !== signedWant || r.balance !== cents(want[2])) { silent++; console.log('SILENT WRONG', r.page, r.line, got, r.balance, want.join(' ')); }
  if (r.date !== passbookDate(want[0])) { dateWrong++; console.log('date wrong in Express', r.page, r.line, r.date, want[0]); }
}
console.log(`engine: status ${statusOf(st)}${group.isPartial(st) ? ' (partial)' : ''} | opening ${st.opening / 100} | ${st.rows.length} transaction lines`);
console.log(`Express file: ${out.fileName ?? 'NONE - ' + out.refused} | ${toExpress.length} rows to Express, ${toCheck.length} to check`);
for (const r of toCheck) console.log(`  to check: page ${r.page} line ${r.line}: ${r.notes.join('; ') || (r.verified ? 'not confirmed by the next line' : 'not proved')}`);
for (const [label, ok, detail] of st.checks) console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label} - ${detail}`);
console.log(`SILENT WRONG MONEY IN EXPRESS: ${silent} | wrong dates in Express: ${dateWrong}`);
if (silent) process.exit(1);
