import { describe, it, expect } from 'vitest';
import { Block, CPK_HEX } from '@/world/types';
import { GRASS_TOP_HEX, GRASS_TOP_SLOT, PALETTE_SLOTS, TERRAIN_HEX, blockHex, oreHex } from '@/world/blocks';
import { hexToLinear as mesherHexToLinear } from '@/world/mesher';
import { PALETTE_LINEAR, hexToLinear, linearColor, linearToSrgb, srgbToLinear, toLinear } from '@/render/palette';

describe('srgbToLinear (06 §11.2)', () => {
  it('maps 0x80 (128/255) to 0.2158 ± 0.001', () => {
    expect(Math.abs(srgbToLinear(0x80 / 255) - 0.2158)).toBeLessThan(0.001);
  });

  it('keeps the ends and the knee of the piecewise curve', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    const knee = 0.04045;
    expect(srgbToLinear(knee)).toBeCloseTo(knee / 12.92, 12);
    // continuity across the knee
    expect(Math.abs(srgbToLinear(knee + 1e-9) - srgbToLinear(knee - 1e-9))).toBeLessThan(1e-6);
  });

  it('is monotonic and inverted by linearToSrgb over every 8-bit level', () => {
    let prev = -1;
    for (let v = 0; v <= 255; v++) {
      const lin = srgbToLinear(v / 255);
      expect(lin).toBeGreaterThan(prev);
      prev = lin;
      expect(linearToSrgb(lin)).toBeCloseTo(v / 255, 9);
    }
  });
});

describe('hexToLinear', () => {
  it('maps 0x808080 to ≈0.2158 per channel', () => {
    for (const c of hexToLinear(0x808080)) expect(c).toBeCloseTo(0.2158, 3);
  });

  it('extracts channels in R, G, B order', () => {
    expect(hexToLinear(0xff0000)).toEqual([1, 0, 0]);
    expect(hexToLinear(0x00ff00)).toEqual([0, 1, 0]);
    expect(hexToLinear(0x0000ff)).toEqual([0, 0, 1]);
  });

  it('agrees with the mesher\'s pure conversion', () => {
    for (const hex of [0x000000, 0xffffff, 0x808080, 0x8a8f96, 0x5fae45, 0xd9c98a, 0x2a2a2e]) {
      const a = hexToLinear(hex);
      const b = mesherHexToLinear(hex);
      for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i] as number, 12);
    }
  });
});

describe('toLinear (three colour management)', () => {
  it('converts sRGB hex to the linear working space exactly like the pure curve', () => {
    for (let v = 0; v <= 255; v++) {
      const hex = (v << 16) | (v << 8) | v;
      const three = toLinear(hex);
      const pure = hexToLinear(hex);
      for (let i = 0; i < 3; i++) expect(Math.abs((three[i] as number) - (pure[i] as number))).toBeLessThan(1e-6);
    }
  });

  it('agrees for every terrain, ore and CPK colour', () => {
    const hexes: number[] = [...Object.values(TERRAIN_HEX), ...Object.values(CPK_HEX), GRASS_TOP_HEX];
    for (const el of ['C', 'N', 'O', 'S', 'F', 'Cl', 'Br', 'I'] as const) hexes.push(oreHex(el));
    for (const hex of hexes) {
      const three = toLinear(hex);
      const pure = hexToLinear(hex);
      for (let i = 0; i < 3; i++) expect(Math.abs((three[i] as number) - (pure[i] as number))).toBeLessThan(1e-6);
    }
  });

  it('linearColor returns a Color whose components are linear', () => {
    const c = linearColor(0x808080);
    expect(c.r).toBeCloseTo(0.2158, 3);
    expect(c.getHex()).toBe(0x808080);
  });
});

describe('PALETTE_LINEAR', () => {
  it('has PALETTE_SLOTS * 3 entries', () => {
    expect(PALETTE_LINEAR.length).toBe(PALETTE_SLOTS * 3);
  });

  it('holds toLinear(blockHex(id)) at id*3 for every terrain and ore id', () => {
    const ids = [Block.Bedrock, Block.Stone, Block.Dirt, Block.Grass, Block.Sand, Block.Glass, Block.LabTile, Block.LabTileEdge,
      Block.Bench, Block.BenchReactantTile, Block.BenchProductTile, Block.OreC, Block.OreN, Block.OreO, Block.OreS, Block.OreF,
      Block.OreCl, Block.OreBr, Block.OreI];
    for (const id of ids) {
      const expected = hexToLinear(blockHex(id));
      for (let i = 0; i < 3; i++) expect(PALETTE_LINEAR[id * 3 + i]).toBeCloseTo(expected[i] as number, 6);
    }
  });

  it('puts the grass top at slot 255 and magenta at unknown ids', () => {
    const top = hexToLinear(GRASS_TOP_HEX);
    for (let i = 0; i < 3; i++) expect(PALETTE_LINEAR[GRASS_TOP_SLOT * 3 + i]).toBeCloseTo(top[i] as number, 6);
    const magenta = hexToLinear(0xff00ff);
    for (const id of [12, 31, 40, 64, 72, 200]) {
      for (let i = 0; i < 3; i++) expect(PALETTE_LINEAR[id * 3 + i]).toBeCloseTo(magenta[i] as number, 6);
    }
  });

  it('stone is the mid grey 0x8a8f96 in linear space', () => {
    const stone = hexToLinear(0x8a8f96);
    expect(PALETTE_LINEAR[Block.Stone * 3]).toBeCloseTo(stone[0], 6);
    expect(PALETTE_LINEAR[Block.Stone * 3 + 1]).toBeCloseTo(stone[1], 6);
    expect(PALETTE_LINEAR[Block.Stone * 3 + 2]).toBeCloseTo(stone[2], 6);
  });
});
