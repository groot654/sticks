// Paper deformations, computed on the CPU per frame.
// Local note space: origin at the note centre, x right, y up, z toward the viewer.
// `base` holds the flat rest positions (x, y, 0) of every vertex.

const PI = Math.PI;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => {
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

// ---------- peel ----------

// Where a point at distance s along D ends up once paper beyond fold line m is rolled
// around a cylinder of radius r (and laid flat, face down, past half a turn).
function curlPos(s, m, r) {
  const d = s - m;
  if (d <= 0) return s;
  if (d < PI * r) return m + r * Math.sin(d / r);
  return m - (d - PI * r);
}

/**
 * Solves the fold for a corner grabbed at P0 and dragged to Q.
 * `inward` is the unit vector from that corner toward the note centre.
 * Returns the fold direction D (pointing at the grabbed side), the fold line m and curl radius r.
 */
export function solvePeel(P0, Q, inward) {
  const vx = Q.x - P0.x, vy = Q.y - P0.y;
  const len = Math.hypot(vx, vy);
  if (len < 0.01) return null;
  const vnx = vx / len, vny = vy / len;
  // Dragging the corner across the note folds it back toward you; pulling it outward
  // still lifts that corner instead of folding the far side of the note.
  const k = smoothstep(-0.2, 0.35, vnx * inward.x + vny * inward.y);
  let dx = lerp(-inward.x, -vnx, k);
  let dy = lerp(-inward.y, -vny, k);
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;

  // curl radius scales with the paper (tuned on a 210px note, corner 148px from centre)
  const scale = Math.hypot(P0.x, P0.y) / 148.5;
  const r = Math.min(44 * scale, 16 * scale + len * 0.14);
  const p = P0.x * dx + P0.y * dy;
  const q = p - len;
  // the corner's projected position grows monotonically with m, so bisection is safe
  let lo = Math.min((p + q - PI * r) / 2, q) - 1;
  let hi = p;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (curlPos(p, mid, r) > q) hi = mid; else lo = mid;
  }
  return { dx, dy, m: (lo + hi) / 2, r, len };
}

export function applyPeel(base, out, fold, z0) {
  const { dx, dy, m, r } = fold;
  for (let i = 0; i < base.length; i += 3) {
    const x = base[i], y = base[i + 1];
    const s = x * dx + y * dy;
    const d = s - m;
    let s2 = s, z = 0;
    if (d > 0) {
      if (d < PI * r) {
        const a = d / r;
        s2 = m + r * Math.sin(a);
        z = r * (1 - Math.cos(a));
      } else {
        s2 = m - (d - PI * r);
        z = 2 * r;
      }
    }
    out[i] = x + (s2 - s) * dx;
    out[i + 1] = y + (s2 - s) * dy;
    out[i + 2] = z0 + z;
  }
}

/**
 * True once the note comes off the wall: when as much of the sheet has peeled up as lies outside
 * the glue strip (~80%), whichever direction it is peeled in. Measuring by peeled area rather
 * than "has the fold touched the glue" stops a diagonal peel letting go a third of the way in.
 */
export function peelDetaches(fold, base, w, h, glueFraction) {
  let peeled = 0;
  for (let i = 0; i < base.length; i += 3) {
    if (base[i] * fold.dx + base[i + 1] * fold.dy > fold.m) peeled++;
  }
  return peeled / (base.length / 3) >= 1 - glueFraction || fold.len > Math.hypot(w, h) * 1.6;
}

// ---------- held in hand ----------

/**
 * A detached note pinched at local point G: it stands off the wall, sags away from the
 * fingers, gets a slight "taco" bend along the hang axis, and flutters when swung.
 */
export function applyHold(base, out, G, w, h, time, flutter) {
  const diag = Math.hypot(w, h);
  const ax = -G.x, ay = -G.y;
  const al = Math.hypot(ax, ay) || 1;
  const ux = ax / al, uy = ay / al;
  for (let i = 0; i < base.length; i += 3) {
    const x = base[i], y = base[i + 1];
    const rx = x - G.x, ry = y - G.y;
    const f = Math.hypot(rx, ry) / diag;
    const perp = rx * uy - ry * ux;
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = 30 + 26 * f * f + 0.0016 * perp * perp + flutter * f * Math.sin(f * 7 - time * 15) * 12;
  }
}

// ---------- crumple ----------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

function randomRotation(rand) {
  // uniform random unit quaternion -> rotation matrix
  const u1 = rand(), u2 = rand() * 2 * PI, u3 = rand() * 2 * PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  const qx = a * Math.sin(u2), qy = a * Math.cos(u2), qz = b * Math.sin(u3), qw = b * Math.cos(u3);
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ];
}

/**
 * Precomputes where every vertex goes in the finished paper ball (centred at 0), plus
 * per-vertex start delays (edges fold in first) and mid-crumple wrinkle offsets.
 */
export function makeCrumple(base, w, h, seed) {
  const rand = rng(seed);
  const n = base.length / 3;
  const target = new Float32Array(base.length);
  const wrinkle = new Float32Array(base.length);
  const delay = new Float32Array(n);
  const R = 26; // ball radius: sized to the bin, so bigger notes don't make it overflow sooner
  const rot = randomRotation(rand);
  const sx = 0.9 + rand() * 0.2, sy = 0.9 + rand() * 0.2, sz = 0.9 + rand() * 0.2;
  const ns = (seed * 7919) | 0;
  let radiusSum = 0;

  for (let i = 0; i < n; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    const u = x / (w / 2), v = y / (h / 2);
    // Wrap the sheet around a ball: its centre at the front, its whole rim gathered at the back.
    // (half square-ring, half round, so neither a square nor a circle outline shows mid-crumple)
    const ring = Math.min(1, 0.5 * Math.max(Math.abs(u), Math.abs(v)) + 0.5 * Math.hypot(u, v) / Math.SQRT2);
    const theta = ring * PI * 0.96;
    const alpha = Math.atan2(v, u);
    const dx = Math.sin(theta) * Math.cos(alpha), dy = Math.sin(theta) * Math.sin(alpha), dz = Math.cos(theta);

    const ridge = 1 - Math.abs(2 * noise3(dx * 2.1 + 5, dy * 2.1, dz * 2.1, ns) - 1);
    const fine = noise3(dx * 5.3, dy * 5.3 + 9, dz * 5.3, ns + 1);
    // lumpy, but the lumps stay close to the physics radius so balls don't poke through the bin
    const rad = R * (0.8 + 0.26 * ridge + 0.1 * fine + 0.06 * (rand() - 0.5));
    radiusSum += rad;

    const px = dx * rad * sx, py = dy * rad * sy, pz = dz * rad * sz;
    target[i * 3] = rot[0] * px + rot[1] * py + rot[2] * pz;
    target[i * 3 + 1] = rot[3] * px + rot[4] * py + rot[5] * pz;
    target[i * 3 + 2] = rot[6] * px + rot[7] * py + rot[8] * pz;

    delay[i] = (1 - ring) * 0.38 + rand() * 0.04;
    const fx = x / 38, fy = y / 38;
    wrinkle[i * 3] = (noise3(fx, fy, 1.5, ns + 2) - 0.5) * 22;
    wrinkle[i * 3 + 1] = (noise3(fx, fy, 7.5, ns + 3) - 0.5) * 22;
    wrinkle[i * 3 + 2] = (1 - Math.abs(2 * noise3(fx * 1.6, fy * 1.6, 3.5, ns + 4) - 1)) * 34;
  }
  return { target, wrinkle, delay, radius: radiusSum / n };
}

/** Blends `from` (any current shape) toward the ball centred at (cx, cy, cz). t: 0..1 */
export function applyCrumple(from, out, crumple, t, cx, cy, cz) {
  const { target, wrinkle, delay } = crumple;
  for (let i = 0, k = 0; i < out.length; i += 3, k++) {
    // delays top out at 0.42, so dividing by 0.57 guarantees every vertex arrives by t = 1
    const e = easeInOut(clamp((t - delay[k]) / 0.57, 0, 1));
    const crease = Math.sin(PI * e) * (1 - t * 0.4);
    out[i] = lerp(from[i], target[i] + cx, e) + wrinkle[i] * crease;
    out[i + 1] = lerp(from[i + 1], target[i + 1] + cy, e) + wrinkle[i + 1] * crease;
    out[i + 2] = lerp(from[i + 2], target[i + 2] + cz, e) + wrinkle[i + 2] * crease;
  }
}
