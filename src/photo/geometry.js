// Pure maths for photos: no canvas, no DOM.

// Solve the 8 unknowns of a perspective map from 4 point pairs (Gaussian
// elimination with partial pivoting). Returns row-major [h0..h8], h8 = 1.
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) throw new Error('corners are in a line - cannot flatten');
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}

export function applyH(H, [x, y]) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('not invertible');
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d]
    .map(v => v / det);
}

export function rotatePoint([x, y], deg, [cx, cy]) {
  const r = deg * Math.PI / 180, dx = x - cx, dy = y - cy;
  return [cx + dx * Math.cos(r) - dy * Math.sin(r), cy + dx * Math.sin(r) + dy * Math.cos(r)];
}

// The tilt (degrees) that makes word centres line up in the flattest rows:
// try every angle in 0.05-degree steps and score how peaked the row histogram
// is (sum of squared counts in `binPx` bins - real photos wobble a pixel or
// two). Neighbouring angles can tie; the middle of the tied run is the
// estimate. null when unsure: the best angle sits at the edge of the search,
// or the words still do not gather into rows (fewer than 2 per row on average).
export function deskewAngle(points, maxDeg = 5, binPx = 2) {
  if (points.length < 6) return null;
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const histogram = deg => {
    const bins = new Map();
    for (const p of points) {
      const y = Math.round(rotatePoint(p, -deg, [cx, cy])[1] / binPx);
      bins.set(y, (bins.get(y) ?? 0) + 1);
    }
    return bins;
  };
  let bestScore = -1, tied = [];
  for (let step = -maxDeg * 20; step <= maxDeg * 20; step++) {
    const deg = step / 20;
    let score = 0;
    for (const n of histogram(deg).values()) score += n * n;
    if (score > bestScore) { bestScore = score; tied = [deg]; }
    else if (score === bestScore) tied.push(deg);
  }
  const lo = tied[0], hi = tied[tied.length - 1];
  if (Math.abs(lo) >= maxDeg || Math.abs(hi) >= maxDeg) return null;
  const best = Math.round((lo + hi) / 2 * 100) / 100;
  if (points.length / histogram(best).size < 2) return null;
  return best;
}
