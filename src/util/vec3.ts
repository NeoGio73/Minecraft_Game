/**
 * Integer/real 3-vector helpers over the readonly `Vec3` tuple.
 * PURE MODULE: no `three`, no DOM. Every function returns a new tuple.
 */
import type { Vec3 } from '../chem/types';

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function neg(a: Vec3): Vec3 {
  return [-a[0], -a[1], -a[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function equals(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** L1 distance; face-adjacent lattice cells are at manhattan 1. */
export function manhattan(a: Vec3, b: Vec3): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

export function isZero(a: Vec3): boolean {
  return a[0] === 0 && a[1] === 0 && a[2] === 0;
}
