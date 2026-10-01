/**
 * Canvas-drawn textures: element symbols for atom blocks, round glyph discs for
 * badges and sprite labels, and the red "x" break-marker plate.
 * DOM/WebGL package (imports three and uses a 2D canvas).
 * docs/design/06-engine.md §12.2; 09-amendment-no-bond.md §5.2.
 *
 * Every texture is cached by its parameters and shared between renderers.
 * Every texture sets `colorSpace = SRGBColorSpace` (the canvas is painted in
 * sRGB; three converts on sampling).
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NearestFilter, SRGBColorSpace } from 'three';
import { CPK_HEX, CPK_TEXT } from '../world/types';
import type { BlockElement } from '../world/types';

export const ELEMENT_TEXTURE_SIZE = 128;
export const GLYPH_TEXTURE_SIZE = 64;
export const BREAK_TEXTURE_SIZE = 64;
/** Anisotropy cap: min(4, gl.capabilities.getMaxAnisotropy()). */
export const ANISOTROPY_CAP = 4;
/** Break-marker red (09 §5.2); BondRenderer re-exports it as BREAK_RED. */
export const BREAK_MARKER_RED = 0xd32f2f;
export const BREAK_BORDER_PX = 4;
export const BREAK_CROSS_PX = 8;

let maxAnisotropy = 1;

/** Called once by the Renderer with `gl.capabilities.getMaxAnisotropy()`; textures made later use min(4, n). */
export function setMaxAnisotropy(n: number): void {
  maxAnisotropy = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  for (const t of cache.values()) t.anisotropy = Math.min(ANISOTROPY_CAP, maxAnisotropy);
}

export function currentAnisotropy(): number {
  return Math.min(ANISOTROPY_CAP, maxAnisotropy);
}

const cache = new Map<string, CanvasTexture>();

export function hexToCss(hex: number): string {
  return '#' + (hex & 0xffffff).toString(16).padStart(6, '0');
}

/** Per-channel multiply of an sRGB hex (used for the darker element border, bg x 0.6). */
export function scaleHex(hex: number, k: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 0xff) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 0xff) * k)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 0xff) * k)));
  return (r << 16) | (g << 8) | b;
}

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

function symbolFont(size: number, text: string): string {
  const px = Math.round(size * 0.7 * (text.length === 1 ? 1 : 0.72));
  return `700 ${px}px system-ui, Arial, sans-serif`;
}

/**
 * Element block face: filled `bgHex`, a 6 px border in bg x 0.6, the symbol
 * centred in `fg` ('white' | 'black' from CPK_TEXT). Mipmapped, linear
 * filtering, anisotropy min(4, max). All six faces share it (BoxGeometry UVs).
 */
export function makeElementTexture(symbol: string, bgHex: number, fg: 'white' | 'black', size = ELEMENT_TEXTURE_SIZE): CanvasTexture {
  const key = `el|${symbol}|${bgHex}|${fg}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = hexToCss(bgHex);
  ctx.fillRect(0, 0, size, size);
  const border = Math.round(size * 6 / 128);
  ctx.lineWidth = border;
  ctx.strokeStyle = hexToCss(scaleHex(bgHex, 0.6));
  ctx.strokeRect(border / 2, border / 2, size - border, size - border);
  ctx.font = symbolFont(size, symbol);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.fillText(symbol, size / 2, size / 2 + size * 0.03);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = currentAnisotropy();
  texture.name = key;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

/**
 * Round disc of `bgHex` with `text` in `fgHex`, transparent corners: charge
 * badges, bond-order glyphs, R/S/E/Z labels, ring-face arrows. Cached by
 * (text, bg, fg, size).
 */
export function makeGlyphTexture(text: string, bgHex: number, fgHex: number, size = GLYPH_TEXTURE_SIZE): CanvasTexture {
  const key = `glyph|${text}|${bgHex}|${fgHex}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { canvas, ctx } = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const r = size / 2 - 1;
  // dark rim under the disc so the badge keeps >= 3:1 against the sky (07 §2.3 two-tone rule)
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = '#101418';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r - Math.max(1, Math.round(size / 32)), 0, Math.PI * 2);
  ctx.fillStyle = hexToCss(bgHex);
  ctx.fill();
  ctx.font = `700 ${Math.round(size * 0.62 * (text.length === 1 ? 1 : 0.7))}px system-ui, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hexToCss(fgHex);
  ctx.fillText(text, size / 2, size / 2 + size * 0.04);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = currentAnisotropy();
  texture.name = key;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

/**
 * Break-marker plate face (09 §5.2): 64x64 filled BREAK_MARKER_RED, a 4 px
 * white border and a white "x" of two 8 px diagonals. NearestFilter (crisp),
 * sRGB. One shared instance (the ghost variant uses the same texture).
 */
export function breakTexture(): CanvasTexture {
  const key = `break|${BREAK_TEXTURE_SIZE}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = BREAK_TEXTURE_SIZE;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = hexToCss(BREAK_MARKER_RED);
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = BREAK_BORDER_PX;
  ctx.strokeRect(BREAK_BORDER_PX / 2, BREAK_BORDER_PX / 2, size - BREAK_BORDER_PX, size - BREAK_BORDER_PX);
  ctx.lineWidth = BREAK_CROSS_PX;
  ctx.lineCap = 'butt';
  const inset = 14;
  ctx.beginPath();
  ctx.moveTo(inset, inset);
  ctx.lineTo(size - inset, size - inset);
  ctx.moveTo(size - inset, inset);
  ctx.lineTo(inset, size - inset);
  ctx.stroke();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.anisotropy = 1;
  texture.name = key;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

/** One CPK-coloured symbol texture per block element, created lazily. */
export interface ElementTextures {
  get(el: BlockElement): CanvasTexture;
}

export function createElementTextures(size = ELEMENT_TEXTURE_SIZE): ElementTextures {
  return {
    get(el: BlockElement): CanvasTexture {
      return makeElementTexture(el, CPK_HEX[el], CPK_TEXT[el], size);
    },
  };
}

/** Context restore (06 §14.7): re-upload every cached canvas texture. */
export function markTexturesNeedUpdate(): void {
  for (const t of cache.values()) t.needsUpdate = true;
}

/** Releases every cached texture (teardown). */
export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

/** Number of cached textures (diagnostics). */
export function textureCount(): number {
  return cache.size;
}
