// One statement, read and checked on its own.
import { StatementError } from './errors.js';
import { readWords } from './words.js';
import { groupIntoRows, rowText } from './rows.js';
import { PROFILES, identify } from './profiles.js';
import { generalProfile } from './general.js';
import { parseHeader } from './header.js';
import { extractRows } from './extract.js';
import { classifyAndVerify, buildChecks } from './verify.js';
import { periodBounds } from './dates.js';

export class Statement {
  constructor(name, profile, facts, opening, rows, closing, checks) {
    Object.assign(this, { name, profile, facts, opening, rows, closing, checks });
  }
  get ok() { return this.checks.every(([, passed]) => passed); }
  // Did the bank print anything independent to check this against? The chain
  // proves each row against the one before, but a row missing from the very
  // END leaves the chain intact - only a printed figure can catch that.
  get anchored() {
    return ['closing_stated', 'withdraw_total', 'deposit_total', 'withdraw_count', 'deposit_count']
      .some(k => this.facts[k] !== null && this.facts[k] !== undefined);
  }
  get bounds() { return periodBounds(this.facts); }
}

// green / yellow / red for a statement on its own (Co's rule A).
export function statusOf(statement) {
  if (!statement.ok) return 'red';
  if (statement.profile.untested) return 'yellow';   // no one has measured this bank: never green
  return statement.anchored ? 'green' : 'yellow';
}

// Read and check one PDF. Each password is tried in turn, then none. pdf.js
// hands the bytes to its worker, which can detach them, so every attempt
// gets its own copy.
export async function readStatement(name, bytes, passwords = [], bank = null, pdfjs) {
  let pages = null;
  const errors = [];
  for (const password of [...passwords, null]) {
    try {
      pages = await readWords(bytes.slice(), password, pdfjs);
      break;
    } catch (e) {
      if (!(e instanceof StatementError)) throw e;
      errors.push(e);
    }
  }
  if (pages === null) {
    // A wrong password says more than the final no-password "locked".
    throw errors.find(e => e.code === 'wrong-password') ?? errors[errors.length - 1];
  }

  const linesByPage = pages.map(p => groupIntoRows(p));
  const allText = linesByPage.flat().map(rowText).join('\n');
  const profile = bank === 'general' ? generalProfile(pages)
    : bank ? PROFILES[bank] : identify(allText) ?? generalProfile(pages);
  if (!profile) throw new StatementError('this statement does not match any bank profile yet', 'unknown-bank');
  const facts = parseHeader(linesByPage.flat(), profile);
  const { opening, rows } = extractRows(pages, profile, facts);
  const closing = classifyAndVerify(opening, rows, profile);
  const checks = buildChecks(opening, rows, closing, facts);
  return new Statement(name, profile, facts, opening, rows, closing, checks);
}
