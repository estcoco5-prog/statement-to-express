// Lines of a page, and the shapes every step recognises.

// Words whose vertical centres are within this many points share a line.
export const ROW_TOLERANCE = 4.0;
// A labelled value ends at the first gap this wide.
export const FIELD_GAP = 40.0;

export const DATE_RE = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/;
export const TIME_RE = /^\d{1,2}:\d{2}$/;

// Cluster words that sit on the same line of the page, left to right.
export function groupIntoRows(words, tolerance = ROW_TOLERANCE) {
  const sorted = [...words].sort((a, b) => a.ycentre - b.ycentre || a.x0 - b.x0);
  const rows = [];
  let current = [], currentY = null;
  for (const word of sorted) {
    if (currentY === null || Math.abs(word.ycentre - currentY) <= tolerance) {
      current.push(word);
      currentY = current.reduce((s, w) => s + w.ycentre, 0) / current.length;
    } else {
      rows.push([...current].sort((a, b) => a.x0 - b.x0));
      current = [word];
      currentY = word.ycentre;
    }
  }
  if (current.length) rows.push([...current].sort((a, b) => a.x0 - b.x0));
  return rows;
}

// The middle of a line, top to bottom.
export const rowY = row => row.reduce((a, w) => a + w.ycentre, 0) / row.length;

export function rowText(row) {
  return row.map(w => w.text).join(' ');
}
