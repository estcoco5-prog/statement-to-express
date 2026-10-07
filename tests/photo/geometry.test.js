import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homography, applyH, invert3, deskewAngle, rotatePoint } from '../../src/photo/geometry.js';

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, `${a} vs ${b}`);

test('a homography maps the 4 corners exactly, and inverts', () => {
  const src = [[12, 30], [610, 8], [640, 900], [5, 870]];          // a photo taken at an angle
  const dst = [[0, 0], [595, 0], [595, 842], [0, 842]];
  const H = homography(src, dst);
  src.forEach((p, i) => { const q = applyH(H, p); near(q[0], dst[i][0]); near(q[1], dst[i][1]); });
  const back = applyH(invert3(H), [297.5, 421]);
  const again = applyH(H, back);
  near(again[0], 297.5); near(again[1], 421);
});

test('corners in a line cannot be flattened', () => {
  assert.throws(() => homography([[0, 0], [1, 1], [2, 2], [3, 3]], [[0, 0], [1, 0], [1, 1], [0, 1]]));
});

test('deskew finds the tilt of text rows and refuses to guess past the limit', () => {
  const pts = [];
  for (const y of [100, 140, 180]) for (let x = 50; x <= 550; x += 50) pts.push(rotatePoint([x, y], 1.5, [300, 140]));
  near(deskewAngle(pts), 1.5, 0.05);
  const steep = pts.map(p => rotatePoint(p, 10, [300, 140]));
  assert.equal(deskewAngle(steep), null);
  assert.equal(deskewAngle([[0, 0]]), null);
});
