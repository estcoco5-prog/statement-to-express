// Full pipeline from words to verified rows - port of the answer key's run().
import { parseHeader } from '../src/engine/header.js';
import { groupIntoRows } from '../src/engine/rows.js';
import { extractRows } from '../src/engine/extract.js';
import { classifyAndVerify, buildChecks } from '../src/engine/verify.js';
import { PROFILES } from '../src/engine/profiles.js';

export function run(pages, profile = PROFILES.kbank) {
  const facts = parseHeader(pages.flatMap(p => groupIntoRows(p)), profile);
  const { opening, rows } = extractRows(pages, profile, facts);
  const closing = classifyAndVerify(opening, rows, profile);
  const checks = buildChecks(opening, rows, closing, facts);
  return { facts, opening, rows, closing, checks };
}

export const byLabel = checks => Object.fromEntries(checks.map(([l, ok, d]) => [l, [ok, d]]));
export const allPass = checks => checks.every(([, ok]) => ok);
