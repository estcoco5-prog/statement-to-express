// Many statements: group by account, order by period, check the joins.
import { statusOf, partialRows } from './statement.js';
import { addDays } from './dates.js';
import { fmtMoney } from './money.js';

// Like Python's os.path.basename on Windows: either slash ends a folder.
const basename = name => String(name).split(/[\\/]/).pop();

// The statements of ONE account, in date order, with the batch checks.
export class Group {
  constructor(profile, account, statements) {
    this.profile = profile;
    this.account = account;
    this.statements = statements;
    this.checks = [];
    this.confirmedByNext = new Set();
    // statement -> why it is kept out of the Express file even though its own
    // checks passed (a second copy of a period already included).
    this.leftOut = new Map();
  }
  status(statement) {
    const own = statusOf(statement);
    // The next month's opening confirms it - unless no one has measured this bank.
    // A photo is never lifted: the link proves the money, not what was read.
    if (own === 'yellow' && this.confirmedByNext.has(statement) && !this.profile.untested
        && !statement.fromPhoto) return 'green';
    return own;
  }
  leftOutReason(statement) {
    if (this.status(statement) === 'red' && !partialRows(statement)) return 'failed its own checks';
    return this.leftOut.get(statement) ?? null;
  }
  // Red but read from photos with only some rows unproved: its proved rows go in.
  isPartial(statement) { return !this.leftOutReason(statement) && this.status(statement) === 'red'; }
  partials() { return this.statements.filter(s => this.isPartial(s)); }
  excluded() { return this.statements.filter(s => this.leftOutReason(s)); }
  expressRows() {
    return this.statements.filter(s => !this.leftOutReason(s)).flatMap(s => (this.isPartial(s) ? partialRows(s) : s.rows));
  }
  get ok() { return this.checks.every(([, passed]) => passed); }
}

// A statement whose account number could not be read is never merged with
// anything: two accounts mixed into one Express file is the one mistake this
// step exists to prevent.
export function groupBatch(statements) {
  const byKey = new Map();
  for (const s of statements) {
    const account = s.facts.account_no;
    const key = `${s.profile.key}\u0000${account || `? ${s.name}`}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(s);
  }
  const groups = [];
  for (const [key, members] of byKey) {
    const account = key.split('\u0000')[1];
    const start = s => (s.bounds ?? ['9999-12-31'])[0];
    members.sort((a, b) => (start(a) < start(b) ? -1 : start(a) > start(b) ? 1 : 0));
    const group = new Group(members[0].profile, account.startsWith('? ') ? null : account, members);
    checkJoins(group);
    groups.push(group);
  }
  return groups;
}

function checkJoins(group) {
  const members = group.statements;
  if (members.length === 1) {
    group.checks.push(['Only one statement for this account', true, 'nothing to link']);
    return;
  }
  const unreadable = members.filter(s => s.bounds === null).map(s => s.name);
  if (unreadable.length) {
    group.checks.push(["Every statement's period could be read", false, unreadable.map(basename).join(', ')]);
    return;
  }

  const links = [], gaps = [], doubles = [];
  let checked = 0;
  let prev = members[0];
  for (const next of members.slice(1)) {
    const [pFrom, pTo] = prev.bounds, [nFrom, nTo] = next.bounds;
    const names = `${basename(prev.name)} and ${basename(next.name)}`;
    if (nFrom <= pTo) {
      // The same days twice: writing both would import every one of those
      // transactions twice, so the later file is kept out.
      doubles.push(pFrom === nFrom && pTo === nTo
        ? `${pFrom} to ${pTo} appears in both ${names}` : `periods overlap: ${names}`);
      group.leftOut.set(next, `same days as ${basename(prev.name)} - left out so nothing is imported twice`);
      continue;
    }
    if (nFrom !== addDays(pTo, 1)) {
      gaps.push(`gap: nothing covers ${addDays(pTo, 1)} to ${addDays(nFrom, -1)}`);
      prev = next;
      continue;
    }
    checked += 1;
    if (prev.closing === next.opening) {
      group.confirmedByNext.add(prev);
    } else {
      links.push(`${pTo} closes at ${fmtMoney(prev.closing)} but ${nFrom} opens at ` +
        `${fmtMoney(next.opening)} (${names})`);
    }
    prev = next;
  }
  group.checks.push(['No statement appears twice', !doubles.length, doubles.join('; ') || 'none']);
  group.checks.push(['No month is missing', !gaps.length, gaps.join('; ') || 'none']);
  group.checks.push(['Each closing balance is the next opening balance', !links.length,
    links.join('; ') || `${checked} of ${checked} links agree`]);
}
