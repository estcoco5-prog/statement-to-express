// Dates, without ever guessing the calendar.
//
// Thai statements print years in either the Buddhist or the Western calendar,
// sometimes both. Getting this wrong by 543 years is the single most dangerous
// thing this program could do, so a year is never judged by its size: the
// statement's own printed period is the anchor. Dates are ISO strings; all
// arithmetic is UTC, so no time zone can shift a day.
import { StatementError } from './errors.js';
import { DATE_RE } from './rows.js';

export const BE_OFFSET = 543;
// How far back a statement period may plausibly lie (2-digit period years only).
const PERIOD_LOOKBACK_YEARS = 20;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = Object.fromEntries(MONTH_NAMES.map((m, i) => [m, i + 1]));
export const D_MON_RE = new RegExp(`^(\\d{1,2}) (${MONTH_NAMES.join('|')})\\w*$`);

const pad = (n, w = 2) => String(n).padStart(w, '0');

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
let todayFn = localToday;
// The processing date, as an ISO string. Tests pin it.
export function setToday(fn) { todayFn = fn ?? localToday; }
export const today = () => todayFn();

function isoOf(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Every date in a period line, as 'dd/mm/yyyy'. Accepts 01/06/2026, 01/10/68
// and '01 Sep 2026'. A 2-digit year is read as whichever of Western/Buddhist
// lands in a plausible window ending today; if both or neither do, it refuses.
export function periodDates(text) {
  const out = [];
  for (const [, d, m, y0] of text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)) {
    let y = y0;
    if (y.length === 2) {
      const now = Number(today().slice(0, 4));
      const fits = [2000 + Number(y), 2500 + Number(y) - BE_OFFSET]
        .filter(c => now - PERIOD_LOOKBACK_YEARS <= c && c <= now + 1);
      if (fits.length !== 1) {
        throw new StatementError(
          `the statement period prints a 2-digit year (${y}) that cannot be read safely ` +
          'as Western or Buddhist - refusing to guess');
      }
      y = String(fits[0]);
    }
    out.push(`${pad(Number(d))}/${pad(Number(m))}/${y}`);
  }
  const dMon = new RegExp(`(\\d{1,2}) (${MONTH_NAMES.join('|')})\\w* (\\d{4})`, 'g');
  for (const [, d, mon, y] of text.matchAll(dMon)) {
    out.push(`${pad(Number(d))}/${pad(MONTHS[mon])}/${y}`);
  }
  return out;
}

// A row's year -> [Western year, warning|null], anchored to the stated period.
export function resolveYear(twoOrFour, periodFrom, periodTo) {
  const periodYears = new Set();
  for (const stamp of [periodFrom, periodTo]) {
    if (stamp) {
      const year = Number(stamp.split('/').pop());
      periodYears.add(year >= 2500 ? year - BE_OFFSET : year);
    }
  }
  if (!periodYears.size) {
    throw new StatementError(
      'the statement period could not be read, so Buddhist and Western years cannot ' +
      'be told apart safely - refusing to guess');
  }
  const low = Math.min(...periodYears) - 1, high = Math.max(...periodYears) + 1;
  const value = Number(twoOrFour);
  const candidates = String(twoOrFour).length === 4
    ? [value >= 2500 ? value - BE_OFFSET : value]
    : [2000 + value, 2500 + value - BE_OFFSET];
  const fits = [...new Set(candidates.filter(c => low <= c && c <= high))].sort((a, b) => a - b);
  if (fits.length === 1) return [fits[0], null];
  if (!fits.length) return [candidates[0], `year ${twoOrFour} is outside the statement period`];
  return [fits[0], `year ${twoOrFour} is ambiguous between [${fits.join(', ')}]`];
}

// The stated period as two ISO dates (Western), or null.
export function periodBounds(facts) {
  const bounds = [];
  for (const stamp of [facts.period_from, facts.period_to]) {
    if (typeof stamp !== 'string') return null;
    const parts = stamp.split('/');
    if (parts.length !== 3 || parts.some(p => !/^\d+$/.test(p))) return null;
    const [d, m, y] = parts.map(Number);
    const iso = isoOf(y >= 2500 ? y - BE_OFFSET : y, m, d);
    if (!iso) return null;
    bounds.push(iso);
  }
  return bounds;
}

// '01 Sep' -> [iso, warning]. The year comes from the statement period: the
// one that puts the date within a month of the period.
export function parseDMon(token, facts) {
  const match = D_MON_RE.exec(token);
  if (!match) return [null, null];
  const bounds = periodBounds(facts);
  if (bounds === null) {
    throw new StatementError(
      'the statement period could not be read, and this bank prints no year on its rows ' +
      '- refusing to guess');
  }
  const lo = addDays(bounds[0], -31), hi = addDays(bounds[1], 31);
  const fits = new Set();
  for (const year of new Set([bounds[0], bounds[1]].map(b => Number(b.slice(0, 4))))) {
    const day = isoOf(year, MONTHS[match[2]], Number(match[1]));
    if (day && lo <= day && day <= hi) fits.add(day);
  }
  if (fits.size === 1) return [[...fits][0], null];
  return [null, `${token} cannot be placed in the statement period`];
}

// '09-06-26' -> ['2026-06-09', warning|null].
export function parseDate(token, facts) {
  const match = DATE_RE.exec(token);
  if (!match) return [null, null];
  const [, day, month, yearRaw] = match;
  const [year, warning] = resolveYear(yearRaw, facts.period_from, facts.period_to);
  if (!(Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31)) {
    return [null, `${token} is not a real date`];
  }
  return [`${pad(year, 4)}-${pad(Number(month))}-${pad(Number(day))}`, warning];
}
