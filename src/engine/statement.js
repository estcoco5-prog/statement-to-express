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

// Co 2026-10-07 (decision B): a statement read from PHOTOS that failed only
// because some rows could not be proved still gives Express its proved rows -
// each confirmed by the running balance and carrying no warning. Any other
// failure (dates going backwards, an anomaly) says the reading itself is in
// doubt, so nothing goes. A bank's own PDF keeps the old rule: red, no file.
const COMPLETENESS = [/^Every row agrees with the running balance$/, /^Final balance matches/,
  /^Total (withdrawals|deposits) matches/, /^Number of (withdrawals|deposits) matches/];
// A passbook (src/passbook) lists every doubtful line on its own - a date that
// goes backwards, a sign that disagrees, the last line - so those checks
// failing still leave its other proved lines safe.
const PASSBOOK_ALSO = [/^Dates never go backwards$/, /^No other anomalies on any row$/,
  /^Last line confirmed by a later line$/, /^Each page carries on from the one before$/];
export function partialRows(statement) {
  if (!statement.fromPhoto || statusOf(statement) !== 'red') return null;
  const failed = statement.checks.filter(([, passed]) => !passed).map(([label]) => label);
  const allowed = statement.passbook ? [...COMPLETENESS, ...PASSBOOK_ALSO] : COMPLETENESS;
  if (!failed.every(label => allowed.some(re => re.test(label)))) return null;
  const proved = statement.rows.filter((r, i) => confirmed(statement, i));
  return proved.length ? proved : null;
}
// A row is only safe for Express when its own amount agrees with the balance
// AND its printed balance is confirmed by what comes after it: the next row
// chains on from it, or, for the last row, the closing balance matches. A
// reader that misreads the same digit in a row's amount and its balance makes
// that row look proved - only the NEXT row shows the break (G8 review).
const CLOSING = /^Final balance matches/;
function confirmed(statement, i) {
  const rows = statement.rows;
  const good = r => r.verified && r.ok;
  if (!good(rows[i])) return false;
  // A tax row split from its interest row (verify.js splitTax) is proved only
  // as a pair with it: it goes exactly when its interest row goes.
  if (rows[i].isTax) return i > 0 && confirmed(statement, i - 1);
  // ...and the balance it was checked AGAINST must be proved too: the line above
  // verified, or - for line 1 - an opening that was printed and read, not one
  // worked back from these very lines. Otherwise one repeated misread (a 3 read
  // as 8 in the balance above AND in this amount) cancels out (G8 passbook review).
  // Line 1 never qualifies: the opening it was checked against was only READ
  // (printed or worked back), never proved - a matching misread in it and in
  // line 1's amount would cancel out (G8 passbook re-review R1).
  const before = i > 0 && rows[i - 1].verified;
  if (!before) return false;
  // The next line confirms this balance by chaining on from it; for a passbook
  // that is all it needs to do (its own date or sign doubt is its own).
  if (i + 1 < rows.length) return statement.passbook ? rows[i + 1].verified : good(rows[i + 1]);
  return statement.checks.some(([label, passed]) => CLOSING.test(label) && passed);
}
// The rows a partial statement leaves out: the ones a person must check.
export const rowsToCheck = statement => statement.rows.filter((r, i) => !confirmed(statement, i));

// green / yellow / red for a statement on its own (Co's rule A).
export function statusOf(statement) {
  if (!statement.ok) return 'red';
  if (statement.fromPhoto) return 'yellow';             // read from a photo: never green (spec 4)
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
  // A PDF made from photos names the bank the photo step recognised; its own
  // mark may have been misread, so that note comes before identify().
  const noted = (pages.bank && Object.hasOwn(PROFILES, pages.bank) ? PROFILES[pages.bank] : null);
  const profile = bank === 'general' ? generalProfile(pages)
    : bank ? PROFILES[bank] : noted ?? identify(allText) ?? generalProfile(pages);
  if (!profile) throw new StatementError('this statement does not match any bank profile yet', 'unknown-bank');
  const facts = parseHeader(linesByPage.flat(), profile, { photo: pages.source === 'photo' });
  const { opening, rows } = extractRows(pages, profile, facts);
  const closing = classifyAndVerify(opening, rows, profile);
  const checks = buildChecks(opening, rows, closing, facts);
  const statement = new Statement(name, profile, facts, opening, rows, closing, checks);
  statement.fromPhoto = pages.source === 'photo';
  return statement;
}
