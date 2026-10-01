/**
 * 2-D value noise and fractional Brownian motion on top of `hash2`.
 * PURE MODULE (no three, no DOM). See docs/design/06-engine.md §3.2.
 */
import { hash2 } from './prng';

const INV_2_32 = 1 / 4294967296;

function smoothstep(f: number): number {
  return f * f * (3 - 2 * f);
}

/** Lattice values hash2(seed, ix, iz) / 2^32 at the four integer corners,
 *  bilinear with smoothstep weights. Result in [0, 1]. */
export function valueNoise2(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const wx = smoothstep(fx);
  const wz = smoothstep(fz);
  const v00 = hash2(seed, ix, iz) * INV_2_32;
  const v10 = hash2(seed, ix + 1, iz) * INV_2_32;
  const v01 = hash2(seed, ix, iz + 1) * INV_2_32;
  const v11 = hash2(seed, ix + 1, iz + 1) * INV_2_32;
  const top = v00 + (v10 - v00) * wx;
  const bottom = v01 + (v11 - v01) * wx;
  return top + (bottom - top) * wz;
}

/**
 * Σ_{o<octaves} gain^o · valueNoise2(seed + o·1013, x·lacunarity^o, z·lacunarity^o)
 * divided by Σ gain^o. The caller applies the base frequency to x and z.
 * Result in [0, 1].
 */
export function fbm2(seed: number, x: number, z: number, octaves: number, lacunarity: number, gain: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(seed + o * 1013, x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}
