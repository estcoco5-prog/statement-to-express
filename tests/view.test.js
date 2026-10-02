import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { summarise, MESSAGES, STATUS_TEXT, maskAccount } from '../src/view.js';

test('every refusal code has Thai and English text', () => {
  for (const c of ['locked', 'wrong-password', 'not-pdf', 'no-text', 'unknown-bank', 'refused'])
    assert.ok(MESSAGES[c].th && MESSAGES[c].en, c);
});

test('a red-only account offers Review files but no Express file', () => {
  const v = summarise({ groups: [{ statuses: ['red'], express: { refused: 'failed its own checks' },
    reviews: ['July.xlsx'] }], refusals: [] });
  assert.ok(!v.downloads.some(d => d.kind === 'express'));
  assert.ok(v.downloads.some(d => d.kind === 'review'));
});

test('one unreadable file does not block the rest', () => {
  const v = summarise({ groups: [{ statuses: ['green'], express: { fileName: 'SCB_1_202607-202607_BKTRN.xlsx' },
    reviews: ['a.xlsx'] }], refusals: [{ name: 'x.jpg', code: 'not-pdf', message: '' }] });
  assert.equal(v.refusals.length, 1);
  assert.ok(v.downloads.some(d => d.kind === 'express'));
});

test('the banner is the worst status read, and blocked when nothing could be read', () => {
  const g = statuses => ({ statuses, express: { fileName: 'f.xlsx' }, reviews: [] });
  assert.equal(summarise({ groups: [g(['green']), g(['green'])], refusals: [] }).banner, 'green');
  assert.equal(summarise({ groups: [g(['green']), g(['yellow'])], refusals: [] }).banner, 'yellow');
  assert.equal(summarise({ groups: [g(['yellow', 'red'])], refusals: [] }).banner, 'red');
  assert.equal(summarise({ groups: [], refusals: [{ name: 'a.pdf', code: 'no-text', message: '' }] }).banner,
    'blocked');
});

test('a refusal carries its Thai and English text, and an unknown code falls back to refused', () => {
  const v = summarise({ groups: [], refusals: [{ name: 'a.pdf', code: 'no-text', message: 'x' },
    { name: 'b.pdf', code: 'something-new', message: 'y' }] });
  assert.equal(v.refusals[0].th, MESSAGES['no-text'].th);
  assert.equal(v.refusals[1].en, MESSAGES.refused.en);
  assert.equal(v.refusals[1].detail, 'y');
});

test('an untested bank account carries the caveat and is never shown green', () => {
  const v = summarise({ groups: [{ untested: true, statuses: ['yellow'], express: { fileName: 'UNTESTED_1_x.xlsx' },
    reviews: [] }], refusals: [] });
  assert.equal(v.accounts[0].untested, true);
  assert.equal(v.accounts[0].status, 'yellow');
});

test('the yellow text says the amounts are proved and asks for an eye check, in both languages', () => {
  assert.match(STATUS_TEXT.yellow.en, /amounts proved; check dates and descriptions by eye/);
  assert.match(STATUS_TEXT.yellow.th, /ยอดเงินตรวจแล้ว โปรดตรวจวันที่และรายละเอียดด้วยตา/);
});

test('an account number is shown by its last 4 digits only', () => {
  assert.equal(maskAccount('123-4-56789-0'), '•••• 7890');
  assert.equal(maskAccount(null), '(account number not read)');
});

test('downloads list every Express file and every Review file, in order', () => {
  const v = summarise({ groups: [
    { statuses: ['green'], express: { fileName: 'A.xlsx' }, reviews: ['a1.xlsx', 'a2.xlsx'] },
    { statuses: ['red'], express: { refused: 'x' }, reviews: ['b1.xlsx'] }], refusals: [] });
  assert.deepEqual(v.downloads.map(d => [d.kind, d.fileName]),
    [['express', 'A.xlsx'], ['review', 'a1.xlsx'], ['review', 'a2.xlsx'], ['review', 'b1.xlsx']]);
});

// The offline copy must hold every file the page loads, or it breaks offline.
test('the service worker caches every page file', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  const cached = new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]));
  const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
  const needed = ['index.html', 'styles.css', ...walk('src').filter(f => f.endsWith('.js')),
    'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs'];
  for (const f of needed) assert.ok(cached.has(f), `service-worker.js does not cache ${f}`);
  assert.match(sw, /const CACHE = 'statement-to-express-v\d+';/);
});
