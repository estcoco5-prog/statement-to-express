// Fixture builders, ported from tests/test_statement.py (word / right_aligned).
import { Word } from '../src/engine/words.js';
export const word = (text, x0, y, width) =>
  new Word(x0, y, x0 + (width ?? Math.max(6, text.length * 2.9)), y + 8, text);
export const rightAligned = (text, x1, y) => {
  const w = Math.max(6, text.length * 2.9);
  return new Word(x1 - w, y, x1, y + 8, text);
};
