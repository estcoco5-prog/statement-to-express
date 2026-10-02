// Made-up Statement objects for batch and Express tests (port of the answer
// key's _stmt() / _row() helpers; every account number is invented).
import { Statement } from '../src/engine/statement.js';
import { Row } from '../src/engine/extract.js';
import { PROFILES } from '../src/engine/profiles.js';

const money = s => Math.round(Number(s) * 100);

export function stmt(key, account, from, to, opening, closing,
  { ok = true, anchored = true, rows = [], name } = {}) {
  const facts = { account_no: account, period_from: from, period_to: to,
    closing_stated: anchored ? money(closing) : null,
    withdraw_total: null, withdraw_count: null, deposit_total: null, deposit_count: null };
  return new Statement(name ?? `${key}-${from}.pdf`, PROFILES[key], facts, money(opening), rows,
    money(closing), [['Every row agrees with the running balance', ok, '']]);
}
export function row(date, withdrawal, balance) {
  const r = new Row();
  r.date = date; r.description = 'x'; r.withdrawal = money(withdrawal); r.amount = r.withdrawal;
  r.balance = money(balance); r.verified = true;
  return r;
}
