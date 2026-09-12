// Face deformation model.
//
// Every slider is a "deformation". Each frame we build a face-local frame from the
// detected landmarks (centre, up vector, right vector, scale, forward direction) and
// accumulate a 3-D displacement for every landmark from all non-zero sliders.
//
// Handle-based deformations list a few landmarks with a direction expressed in the
// face frame: `lat` (outward from the midline), `up` (toward the forehead) and `fwd`
// (along the direction the face points). Head-on, `fwd` moves points in depth only,
// which the relighting in shading.js turns into light and shadow; as the head turns
// it also becomes a visible shift across the screen.
// Every other landmark follows the handles with a Gaussian falloff, so the whole
// region moves coherently instead of just a few points.

import { LANDMARK_COUNT, RIGHT_IRIS, LEFT_IRIS } from './mesh-data.js';

// Pair helper: [subject-right index, subject-left index] share one direction.
// Subject-right landmarks have the smaller x in the un-mirrored camera image.
const P = (r, l, lat = 0, up = 0, fwd = 0) => [
  { i: r, lat, up, fwd, side: -1 },
  { i: l, lat, up, fwd, side: 1 },
];
// Midline landmark helper (no lateral component).
const M = (i, up = 0, fwd = 0) => [{ i, lat: 0, up, fwd, side: 0 }];

export const TABS = [
  { id: 'jaw', label: 'Jaw' },
  { id: 'eyes', label: 'Eyes' },
  { id: 'midface', label: 'Midface' },
  { id: 'nose', label: 'Nose' },
];

// `max` is the peak displacement as a fraction of the face scale; `radius` is the
// Gaussian falloff radius (also a fraction of the face scale).
export const DEFORMATIONS = [
  // ---------------------------------------------------------------- jaw
  {
    id: 'jawAngle', tab: 'jaw', label: 'Jaw angle', kind: 'handles', max: 0.06, radius: 0.16,
    handles: [
      ...P(58, 288, 1.0, -0.3, 0.3), ...P(172, 397, 0.85, -0.2, 0.3), ...P(132, 361, 0.55, -0.2, 0.2),
      ...P(136, 365, 0.55, -0.1, 0.3), ...P(215, 435, 0.5, -0.15, 0.2), ...P(138, 367, 0.4, -0.1, 0.2),
      ...P(213, 433, 0.35, -0.1, 0.1), ...P(93, 323, 0.25, -0.1, 0.1),
    ],
  },
  {
    id: 'jawWidth', tab: 'jaw', label: 'Jaw width', kind: 'handles', max: 0.06, radius: 0.15,
    handles: [
      ...P(172, 397, 1.0), ...P(136, 365, 1.0), ...P(150, 379, 0.8), ...P(149, 378, 0.5),
      ...P(58, 288, 0.6), ...P(135, 364, 0.8), ...P(169, 394, 0.7), ...P(170, 395, 0.6),
      ...P(210, 430, 0.6), ...P(214, 434, 0.5), ...P(211, 431, 0.5),
    ],
  },
  {
    id: 'chinProjection', tab: 'jaw', label: 'Chin projection', kind: 'handles', max: 0.08, radius: 0.14,
    handles: [
      ...M(152, -0.25, 1.0), ...M(175, -0.15, 1.0), ...M(199, -0.1, 0.8), ...M(200, 0, 0.5),
      ...P(148, 377, 0, -0.2, 0.85), ...P(176, 400, 0, -0.1, 0.6), ...P(171, 396, 0, -0.1, 0.7),
      ...P(140, 369, 0, 0, 0.5), ...P(208, 428, 0, 0, 0.4),
    ],
  },
  {
    id: 'chinHeight', tab: 'jaw', label: 'Chin height', kind: 'handles', max: 0.06, radius: 0.14,
    handles: [
      ...M(152, -1.0), ...M(175, -0.8), ...M(199, -0.5), ...M(200, -0.25),
      ...P(148, 377, 0, -0.9), ...P(176, 400, 0, -0.7), ...P(149, 378, 0, -0.4),
      ...P(171, 396, 0, -0.6), ...P(140, 369, 0, -0.4), ...P(208, 428, 0, -0.3),
    ],
  },

  // ---------------------------------------------------------------- eyes
  {
    id: 'canthalTilt', tab: 'eyes', label: 'Canthal tilt', kind: 'handles', max: 0.035, radius: 0.07,
    handles: [
      ...P(33, 263, 0, 1.0), ...P(130, 359, 0, 0.9), ...P(226, 446, 0, 0.7), ...P(7, 249, 0, 0.8),
      ...P(246, 466, 0, 0.8), ...P(163, 390, 0, 0.5), ...P(161, 388, 0, 0.5), ...P(247, 467, 0, 0.6),
      ...P(133, 362, 0, -0.6), ...P(173, 398, 0, -0.4), ...P(155, 382, 0, -0.4),
      ...P(243, 463, 0, -0.5), ...P(244, 464, 0, -0.4), ...P(245, 465, 0, -0.3),
    ],
  },
  {
    id: 'eyeSize', tab: 'eyes', label: 'Eye size', kind: 'scale', max: 0.25, radius: 0.09,
    centers: [[RIGHT_IRIS], [LEFT_IRIS]],
  },
  {
    id: 'eyeSpacing', tab: 'eyes', label: 'Eye spacing', kind: 'shift', max: 0.04, radius: 0.12,
    centers: [{ idx: [RIGHT_IRIS], lat: 1 }, { idx: [LEFT_IRIS], lat: 1 }],
  },
  {
    id: 'browRidge', tab: 'eyes', label: 'Brow ridge', kind: 'handles', max: 0.05, radius: 0.08,
    handles: [
      ...P(46, 276, 0, -0.5, 1.0), ...P(53, 283, 0, -0.5, 1.0), ...P(52, 282, 0, -0.4, 1.0),
      ...P(65, 295, 0, -0.35, 0.8), ...P(55, 285, 0, -0.3, 0.6), ...P(70, 300, 0, -0.4, 0.8),
      ...P(63, 293, 0, -0.4, 0.8), ...P(105, 334, 0, -0.3, 0.7), ...P(66, 296, 0, -0.3, 0.6),
      ...P(107, 336, 0, -0.2, 0.4), ...P(124, 353, 0, -0.3, 0.6), ...P(113, 342, 0, -0.3, 0.5),
      ...P(225, 445, 0, -0.4, 0.7), ...P(224, 444, 0, -0.35, 0.7), ...P(223, 443, 0, -0.3, 0.7),
      ...P(222, 442, 0, -0.3, 0.6), ...P(221, 441, 0, -0.25, 0.5), ...M(9, -0.2, 0.5), ...M(8, 0, 0.4),
    ],
  },

  // ---------------------------------------------------------------- midface
  {
    id: 'cheekbones', tab: 'midface', label: 'Cheekbones', kind: 'handles', max: 0.05, radius: 0.12,
    handles: [
      ...P(116, 345, 1.0, 0.3, 0.7), ...P(117, 346, 0.9, 0.3, 0.8), ...P(118, 347, 0.7, 0.3, 0.7),
      ...P(123, 352, 0.9, 0.2, 0.5), ...P(111, 340, 0.9, 0.3, 0.6), ...P(50, 280, 0.6, 0.3, 0.6),
      ...P(101, 330, 0.4, 0.3, 0.4), ...P(147, 376, 0.6, 0.1, 0.3), ...P(227, 447, 0.8, 0.2, 0.3),
      ...P(137, 366, 0.6, 0.1, 0.2), ...P(234, 454, 0.4, 0, 0), ...P(93, 323, 0.5, 0, 0.1),
      ...P(127, 356, 0.4, 0.1, 0.1),
    ],
  },
  {
    id: 'cheekHollow', tab: 'midface', label: 'Cheek hollow', kind: 'handles', max: 0.05, radius: 0.1,
    handles: [
      ...P(205, 425, -0.6, 0, -1.0), ...P(207, 427, -0.5, 0, -0.9), ...P(187, 411, -0.5, 0, -0.8),
      ...P(147, 376, -0.4, 0, -0.5), ...P(192, 416, -0.4, 0, -0.6), ...P(213, 433, -0.4, 0, -0.5),
      ...P(215, 435, -0.3, 0, -0.4), ...P(138, 367, -0.3, 0, -0.4), ...P(123, 352, -0.2, 0, -0.3),
      ...P(50, 280, -0.3, 0, -0.5), ...P(206, 426, -0.3, 0, -0.6), ...P(216, 436, -0.3, 0, -0.5),
    ],
  },
  {
    id: 'lipFullness', tab: 'midface', label: 'Lip fullness', kind: 'scale', max: 0.35, radius: 0.09, axis: 'up',
    centers: [[13, 14]],
  },
  {
    id: 'philtrum', tab: 'midface', label: 'Philtrum length', kind: 'shift', max: 0.035, radius: 0.12,
    centers: [{ idx: [13, 14], up: -1 }],
  },

  // ---------------------------------------------------------------- nose
  {
    id: 'noseBridge', tab: 'nose', label: 'Nose bridge', kind: 'handles', max: 0.05, radius: 0.07,
    handles: [
      ...M(6, 0, 1.0), ...M(197, 0, 1.0), ...M(195, 0, 0.9), ...M(5, 0, 0.7), ...M(168, 0, 0.6),
      ...M(4, 0, 0.4), ...M(8, 0, 0.3),
      ...P(196, 419, -0.3, 0, 0.7), ...P(3, 248, -0.3, 0, 0.7), ...P(51, 281, -0.3, 0, 0.6),
      ...P(122, 351, -0.3, 0, 0.5), ...P(174, 399, -0.2, 0, 0.4), ...P(236, 456, -0.2, 0, 0.3),
      ...P(188, 412, -0.2, 0, 0.3), ...P(217, 437, -0.1, 0, 0.3), ...P(45, 275, 0, 0, 0.3),
      ...P(44, 274, 0, 0, 0.2),
    ],
  },
  {
    id: 'noseWidth', tab: 'nose', label: 'Nose width', kind: 'handles', max: 0.04, radius: 0.06,
    handles: [
      ...P(129, 358, 1.0), ...P(98, 327, 0.9), ...P(64, 294, 0.9), ...P(48, 278, 0.8),
      ...P(49, 279, 0.9), ...P(131, 360, 0.8), ...P(209, 429, 0.7), ...P(102, 331, 0.6),
      ...P(219, 439, 0.6), ...P(240, 460, 0.6), ...P(75, 305, 0.5), ...P(59, 289, 0.5),
      ...P(235, 455, 0.5), ...P(166, 392, 0.3),
    ],
  },
  {
    id: 'noseTip', tab: 'nose', label: 'Tip projection', kind: 'handles', max: 0.06, radius: 0.07,
    handles: [
      ...M(4, 0, 1.0), ...M(1, 0, 1.0), ...M(5, 0, 0.6), ...M(19, 0, 0.8), ...M(94, 0, 0.6), ...M(2, 0, 0.5),
      ...P(45, 275, 0, 0, 0.6), ...P(44, 274, 0, 0, 0.6), ...P(220, 440, 0, 0, 0.5),
      ...P(237, 457, 0, 0, 0.4), ...P(125, 354, 0, 0, 0.4), ...P(141, 370, 0, 0, 0.4),
    ],
  },
  {
    id: 'noseTipRotation', tab: 'nose', label: 'Tip upturn', kind: 'handles', max: 0.04, radius: 0.07,
    handles: [
      ...M(4, 0.6), ...M(1, 1.0), ...M(2, 1.0), ...M(19, 0.8), ...M(94, 0.8), ...M(164, 0.3),
      ...P(141, 370, 0, 0.7), ...P(125, 354, 0, 0.6), ...P(220, 440, 0, 0.5), ...P(237, 457, 0, 0.5),
      ...P(44, 274, 0, 0.4), ...P(45, 275, 0, 0.3), ...P(48, 278, 0, 0.4), ...P(64, 294, 0, 0.4),
      ...P(98, 327, 0, 0.3), ...P(75, 305, 0, 0.3), ...P(59, 289, 0, 0.3), ...P(240, 460, 0, 0.4),
      ...P(219, 439, 0, 0.4), ...P(235, 455, 0, 0.4), ...P(166, 392, 0, 0.3),
    ],
  },
];

// Global slider that is not part of a tab. Negative = leaner, positive = fuller.
export const BODY_FAT = { id: 'bodyFat', label: 'Body fat', max: 0.12 };

export const ALL_SLIDER_IDS = [...DEFORMATIONS.map((d) => d.id), BODY_FAT.id];

// How strongly the projected forward direction drives "fwd" handles. A yaw of
// about 35° gives full effect; head-on gives almost nothing, which is the honest
// answer for projection changes seen from the front.
const YAW_FULL_FRONT = 0.55; // ~33°
const YAW_FULL_SIDE = 0.4; // ~24°: side mode reaches full strength with less turn

/**
 * Build the face frame from landmarks in pixel space.
 * @param {Float32Array} pts  x,y,z triples for 478 landmarks (pixels)
 * @param {Float32Array|number[]|null} matrix  4x4 column-major facial transform, or null
 */
export function faceFrame(pts, matrix) {
  const g = (i) => [pts[i * 3], pts[i * 3 + 1]];
  const top = g(10);
  const chin = g(152);
  const earR = g(234);
  const earL = g(454);
  const cx = (top[0] + chin[0]) / 2;
  const cy = (top[1] + chin[1]) / 2;
  let ux = top[0] - chin[0];
  let uy = top[1] - chin[1];
  const faceH = Math.hypot(ux, uy) || 1;
  ux /= faceH;
  uy /= faceH;
  // Right vector points toward increasing image x for an upright face.
  const rx = -uy;
  const ry = ux;
  const faceW = Math.hypot(earL[0] - earR[0], earL[1] - earR[1]);
  // Ear-to-ear width collapses when the head turns; blend with height so the
  // scale stays stable across poses.
  const scale = Math.max(faceW, 0.78 * faceH);

  // Forward direction projected onto the screen. Prefer the head-pose matrix;
  // fall back to the nose-vs-ear offset.
  // Forward axis of the face in landmark space (x right, y down, z into the screen,
  // so a face looking straight at the camera has forward = (0, 0, -1)).
  let fx;
  let fy;
  let fz;
  if (matrix && matrix.length === 16) {
    // Column-major; the third column is the face's forward axis in camera space.
    // Camera y is up and z points at the viewer; landmark y is down and z away.
    fx = matrix[8];
    fy = -matrix[9];
    fz = -matrix[10];
  } else {
    const nose = g(1);
    fx = Math.max(-1, Math.min(1, ((nose[0] - (earR[0] + earL[0]) / 2) / scale) * 1.6));
    fy = 0;
    fz = -Math.sqrt(Math.max(0, 1 - fx * fx));
  }
  const yaw = Math.abs(fx);

  const eyeY = (pts[RIGHT_IRIS * 3 + 1] + pts[LEFT_IRIS * 3 + 1]) / 2;
  const eyeX = (pts[RIGHT_IRIS * 3] + pts[LEFT_IRIS * 3]) / 2;

  return { cx, cy, ux, uy, rx, ry, scale, fx, fy, fz, yaw, eyeX, eyeY, chinX: chin[0], chinY: chin[1] };
}

/**
 * Compute displaced landmark positions.
 * @param {Float32Array} pts   base landmark positions (pixels, x,y,z triples)
 * @param {object} frame       result of faceFrame()
 * @param {Object<string, number>} values  slider values in [-1, 1] keyed by id
 * @param {'front'|'side'} mode
 * @param {Float32Array} out   receives x,y,z triples for LANDMARK_COUNT points
 */
export function applyDeformations(pts, frame, values, mode, out) {
  const n = LANDMARK_COUNT;
  out.set(pts.subarray(0, n * 3));
  const { ux, uy, rx, ry, scale, fx, fy, fz } = frame;
  const yawFull = mode === 'side' ? YAW_FULL_SIDE : YAW_FULL_FRONT;
  // Screen-space vector for "forward" handles, saturating at full turn.
  const gain = Math.min(1, Math.hypot(fx, fy) / yawFull);
  const flen = Math.hypot(fx, fy) || 1;
  // On screen the forward handles move along the projected forward axis, saturating
  // once the head is turned enough. In depth they always move along the true axis, so
  // a head-on face still gets the relighting even though nothing shifts in 2-D.
  const fwdX = (fx / flen) * gain;
  const fwdY = (fy / flen) * gain;
  const fwdZ = fz;
  // Lateral (width) changes read wrongly on a turned head, so fade them out.
  const latGain = 1 - 0.75 * Math.min(1, Math.abs(fx) / 0.7);

  for (const d of DEFORMATIONS) {
    const a = values[d.id] || 0;
    if (a === 0) continue;
    const amp = a * d.max * scale;
    const sigma = d.radius * scale;
    const inv = 1 / (sigma * sigma);

    if (d.kind === 'handles') {
      const hs = d.handles;
      const hn = hs.length;
      // Precompute handle positions and vectors.
      const hx = new Float32Array(hn);
      const hy = new Float32Array(hn);
      const vx = new Float32Array(hn);
      const vy = new Float32Array(hn);
      const vz = new Float32Array(hn);
      for (let h = 0; h < hn; h++) {
        const H = hs[h];
        hx[h] = pts[H.i * 3];
        hy[h] = pts[H.i * 3 + 1];
        const lat = H.lat * H.side * latGain;
        vx[h] = amp * (lat * rx + H.up * ux + H.fwd * fwdX);
        vy[h] = amp * (lat * ry + H.up * uy + H.fwd * fwdY);
        vz[h] = amp * H.fwd * fwdZ;
      }
      for (let i = 0; i < n; i++) {
        const px = pts[i * 3];
        const py = pts[i * 3 + 1];
        let wsum = 0;
        let dx = 0;
        let dy = 0;
        let dz = 0;
        for (let h = 0; h < hn; h++) {
          const ex = px - hx[h];
          const ey = py - hy[h];
          const w = Math.exp(-(ex * ex + ey * ey) * inv);
          if (w < 1e-4) continue;
          wsum += w;
          dx += w * vx[h];
          dy += w * vy[h];
          dz += w * vz[h];
        }
        if (wsum > 0) {
          // Shepard-style blend of handle vectors, scaled by how close we are to any handle.
          const k = Math.min(1, wsum) / wsum;
          out[i * 3] += dx * k;
          out[i * 3 + 1] += dy * k;
          out[i * 3 + 2] += dz * k;
        }
      }
    } else if (d.kind === 'scale') {
      for (const c of d.centers) {
        let cx = 0;
        let cy = 0;
        for (const ci of c) {
          cx += pts[ci * 3];
          cy += pts[ci * 3 + 1];
        }
        cx /= c.length;
        cy /= c.length;
        const s = a * d.max;
        for (let i = 0; i < n; i++) {
          const ex = pts[i * 3] - cx;
          const ey = pts[i * 3 + 1] - cy;
          const w = Math.exp(-(ex * ex + ey * ey) * inv);
          if (w < 1e-4) continue;
          if (d.axis === 'up') {
            const t = ex * ux + ey * uy;
            out[i * 3] += s * w * t * ux;
            out[i * 3 + 1] += s * w * t * uy;
          } else {
            out[i * 3] += s * w * ex;
            out[i * 3 + 1] += s * w * ey;
          }
        }
      }
    } else if (d.kind === 'shift') {
      for (const c of d.centers) {
        let cx = 0;
        let cy = 0;
        for (const ci of c.idx) {
          cx += pts[ci * 3];
          cy += pts[ci * 3 + 1];
        }
        cx /= c.idx.length;
        cy /= c.idx.length;
        // Lateral shift is outward from the midline for the side the centre is on.
        const side = (cx - frame.cx) * rx + (cy - frame.cy) * ry < 0 ? -1 : 1;
        const lat = (c.lat || 0) * side * latGain;
        const up = c.up || 0;
        const vx = amp * (lat * rx + up * ux);
        const vy = amp * (lat * ry + up * uy);
        for (let i = 0; i < n; i++) {
          const ex = pts[i * 3] - cx;
          const ey = pts[i * 3 + 1] - cy;
          const w = Math.exp(-(ex * ex + ey * ey) * inv);
          if (w < 1e-4) continue;
          out[i * 3] += vx * w;
          out[i * 3 + 1] += vy * w;
        }
      }
    }
  }

  // Body fat: pull the lower face toward the midline (leaner) or push it out (fuller).
  const fat = values[BODY_FAT.id] || 0;
  if (fat !== 0) {
    const s = fat * BODY_FAT.max * latGain;
    const { eyeX, eyeY, chinX, chinY, cx, cy } = frame;
    const span = (chinX - eyeX) * -ux + (chinY - eyeY) * -uy || 1; // eye line to chin, along "down"
    for (let i = 0; i < n; i++) {
      const px = pts[i * 3];
      const py = pts[i * 3 + 1];
      const down = ((px - eyeX) * -ux + (py - eyeY) * -uy) / span;
      const t = Math.max(0, Math.min(1, down));
      const w = 0.12 + 0.88 * t * t;
      const lateral = (px - cx) * rx + (py - cy) * ry;
      out[i * 3] += s * w * lateral * rx;
      out[i * 3 + 1] += s * w * lateral * ry;
      // A fuller face also carries a slightly heavier, lower chin and jowls.
      const sag = s * 0.25 * t * t * scale * 0.5;
      out[i * 3] += -sag * ux;
      out[i * 3 + 1] += -sag * uy;
      // Volume: a fuller lower face bulges toward the camera in its middle and falls
      // away at the outline, which is what the relighting picks up as softness.
      const rim = Math.min(1, Math.abs(lateral) / (0.5 * scale));
      out[i * 3 + 2] += s * w * 0.35 * scale * (1 - rim * rim) * fz;
    }
  }
}
