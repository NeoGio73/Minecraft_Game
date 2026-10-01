/**
 * Terrain palette, ore colours and student-facing block names.
 * PURE MODULE (no three, no DOM). See docs/design/06-engine.md §2.2.
 */
import { Block, CPK_HEX, elementOf, isAtom, isOre } from './types';
import type { BlockElement } from './types';

/** sRGB hex per terrain block id (§2.2 table). Grass's +y face uses GRASS_TOP_SLOT. */
export const TERRAIN_HEX: Readonly<Record<number, number>> = {
  [Block.Bedrock]: 0x2a2a2e,
  [Block.Stone]: 0x8a8f96,
  [Block.Dirt]: 0x6b4a2b,
  [Block.Grass]: 0x7a5a35,
  [Block.Sand]: 0xd9c98a,
  [Block.Glass]: 0xbfe6f5,
  [Block.LabTile]: 0xdde3e8,
  [Block.LabTileEdge]: 0xf2b632,
  [Block.Bench]: 0x4b5a6a,
  [Block.BenchReactantTile]: 0xc9a7a7,
  [Block.BenchProductTile]: 0xa7c9b0,
};

/** Palette slot for the +y face of Grass. */
export const GRASS_TOP_SLOT = 255;
export const GRASS_TOP_HEX = 0x5fae45;
export const PALETTE_SLOTS = 256;

/** Element names used by blockName and the hover text. */
export const ELEMENT_NAMES: Readonly<Record<BlockElement, string>> = {
  C: 'Carbon', N: 'Nitrogen', O: 'Oxygen', S: 'Sulfur', F: 'Fluorine', Cl: 'Chlorine', Br: 'Bromine', I: 'Iodine', H: 'Hydrogen',
};

const TERRAIN_NAMES: Readonly<Record<number, string>> = {
  [Block.Air]: 'Air',
  [Block.Bedrock]: 'Bedrock',
  [Block.Stone]: 'Stone',
  [Block.Dirt]: 'Dirt',
  [Block.Grass]: 'Grass',
  [Block.Sand]: 'Sand',
  [Block.Glass]: 'Glass',
  [Block.LabTile]: 'Lab tile',
  [Block.LabTileEdge]: 'Lab tile edge',
  [Block.Bench]: 'Reaction bench',
  [Block.BenchReactantTile]: 'Reactant zone tile',
  [Block.BenchProductTile]: 'Product zone tile',
};

/** mix(TERRAIN_HEX[Stone], CPK_HEX[el], 0.5) with per-channel Math.round. */
export function oreHex(el: Exclude<BlockElement, 'H'>): number {
  const stone = TERRAIN_HEX[Block.Stone] as number;
  const cpk = CPK_HEX[el];
  const r = Math.round((((stone >> 16) & 0xff) + ((cpk >> 16) & 0xff)) / 2);
  const g = Math.round((((stone >> 8) & 0xff) + ((cpk >> 8) & 0xff)) / 2);
  const b = Math.round(((stone & 0xff) + (cpk & 0xff)) / 2);
  return (r << 16) | (g << 8) | b;
}

/** TERRAIN_HEX[id] ?? oreHex(elementOf(id)) ?? 0xff00ff. */
export function blockHex(id: number): number {
  const t = TERRAIN_HEX[id];
  if (t !== undefined) return t;
  if (isOre(id)) {
    const el = elementOf(id);
    if (el !== undefined && el !== 'H') return oreHex(el);
  }
  return 0xff00ff;
}

/** true when `id` has a colour in the chunk palette (terrain or ore). */
export function hasBlockHex(id: number): boolean {
  return TERRAIN_HEX[id] !== undefined || isOre(id);
}

/** Student-facing name (§2.2 "name" column): "Carbon ore", "Chlorine atom", "Stone". */
export function blockName(id: number): string {
  const t = TERRAIN_NAMES[id];
  if (t !== undefined) return t;
  const el = elementOf(id);
  if (el !== undefined) {
    if (isOre(id)) return `${ELEMENT_NAMES[el]} ore`;
    if (isAtom(id)) return `${ELEMENT_NAMES[el]} atom`;
  }
  return 'Unknown block';
}

/** Only atom blocks can be placed (from the hotbar). */
export function placeableFromInventory(id: number): boolean {
  return isAtom(id);
}
