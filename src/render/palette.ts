/**
 * Colour conversion for the chunk palette and every render colour.
 * DOM/WebGL package (imports three; nothing from the DOM).
 * docs/design/06-engine.md §11.2.
 *
 * Vertex colours are consumed linear by three's shaders, so the chunk palette
 * is built once in linear space. `toLinear` goes through three's colour
 * management (`new Color(hex)` converts sRGB to the linear working space);
 * `srgbToLinear` / `hexToLinear` are the explicit piecewise curve, kept pure so
 * the node test can check that both agree.
 */
import { Color } from 'three';
import { buildPaletteLinear } from '../world/mesher';

/** sRGB channel in [0, 1] -> linear, the standard piecewise curve. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear channel in [0, 1] -> sRGB (inverse of srgbToLinear). */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Pure: 0xRRGGBB -> linear [r, g, b] in [0, 1]. */
export function hexToLinear(hex: number): readonly [number, number, number] {
  return [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ];
}

/** 0xRRGGBB -> linear [r, g, b] through three's colour management. */
export function toLinear(hex: number): readonly [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/** PALETTE_SLOTS * 3 linear floats: slot id*3 holds toLinear(blockHex(id)); slot 255 is the grass top. */
export const PALETTE_LINEAR: Float32Array = buildPaletteLinear(toLinear);

/** A fresh three Color for an sRGB hex (converted to the linear working space). */
export function linearColor(hex: number): Color {
  return new Color(hex);
}
