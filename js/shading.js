// Relighting from mesh normals.
//
// The tracked mesh carries depth, so both the original and the deformed face have a
// surface normal at every landmark. Lighting each with the same simple frontal light and
// taking the ratio tells us how much brighter or darker each point should become once
// it has been pushed out or pulled in. The renderer multiplies the warped image by that
// ratio, which is what makes a projected chin catch light and a hollowed cheek fall into
// shadow, even when the head is seen straight on and nothing moves in 2-D.

import { TRIANGLES, LANDMARK_COUNT } from './mesh-data.js';

// Light direction (from the surface toward the light) in landmark space: x right,
// y down, z into the screen. Mostly from the camera, a little from above.
const LIGHT = normalize3(0, -0.35, -1);
const AMBIENT = 0.5;
const DIFFUSE = 1 - AMBIENT;
const MIN_RATIO = 0.7;
const MAX_RATIO = 1.3;
// Skin is matte: let a surface fall into shadow more readily than it catches a highlight.
const HIGHLIGHT_GAIN = 0.45;
const SHADOW_GAIN = 0.85;
// Smoothing passes over mesh neighbours; the mesh is coarse and irregular, so raw
// per-vertex ratios come out blotchy.
const SMOOTH_PASSES = 2;

const nBase = new Float32Array(LANDMARK_COUNT * 3);
const nWarp = new Float32Array(LANDMARK_COUNT * 3);
const logRatio = new Float32Array(LANDMARK_COUNT);
const scratch = new Float32Array(LANDMARK_COUNT);
const neighbours = buildNeighbours();

function buildNeighbours() {
  const sets = Array.from({ length: LANDMARK_COUNT }, () => new Set());
  const t = TRIANGLES;
  for (let k = 0; k < t.length; k += 3) {
    const [a, b, c] = [t[k], t[k + 1], t[k + 2]];
    sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b);
  }
  return sets.map((s) => Int16Array.from(s));
}

function smooth(values) {
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const nb = neighbours[i];
      if (nb.length === 0) { scratch[i] = values[i]; continue; }
      let sum = 0;
      for (let k = 0; k < nb.length; k++) sum += values[nb[k]];
      scratch[i] = 0.4 * values[i] + 0.6 * (sum / nb.length);
    }
    values.set(scratch);
  }
}

function normalize3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Area-weighted vertex normals for a 478-point mesh (x,y,z triples). */
function vertexNormals(p, out) {
  out.fill(0);
  const t = TRIANGLES;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3;
    const b = t[k + 1] * 3;
    const c = t[k + 2] * 3;
    const abx = p[b] - p[a]; const aby = p[b + 1] - p[a + 1]; const abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a]; const acy = p[c + 1] - p[a + 1]; const acz = p[c + 2] - p[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      out[v] += nx; out[v + 1] += ny; out[v + 2] += nz;
    }
  }
  // Triangle winding is arbitrary, so orient every normal toward the camera (-z).
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    let x = out[i * 3]; let y = out[i * 3 + 1]; let z = out[i * 3 + 2];
    if (z > 0) { x = -x; y = -y; z = -z; }
    const l = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
}

function lambert(n, i) {
  const d = n[i * 3] * LIGHT[0] + n[i * 3 + 1] * LIGHT[1] + n[i * 3 + 2] * LIGHT[2];
  return AMBIENT + DIFFUSE * Math.max(0, d);
}

/**
 * Per-vertex brightness ratio between the deformed and the original mesh.
 * @param {Float32Array} base   original landmarks (x,y,z pixels)
 * @param {Float32Array} warped deformed landmarks (x,y,z pixels)
 * @param {Float32Array} out    LANDMARK_COUNT ratios
 */
export function computeShade(base, warped, out) {
  vertexNormals(base, nBase);
  vertexNormals(warped, nWarp);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    logRatio[i] = Math.log(lambert(nWarp, i) / lambert(nBase, i));
  }
  smooth(logRatio);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const l = logRatio[i] * (logRatio[i] > 0 ? HIGHLIGHT_GAIN : SHADOW_GAIN);
    out[i] = Math.min(MAX_RATIO, Math.max(MIN_RATIO, Math.exp(l)));
  }
}
