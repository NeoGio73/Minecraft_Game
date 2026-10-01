import { describe, it, expect } from 'vitest';
import { Block, CHUNK_W, CHUNK_H, CHUNK_D } from '@/world/types';
import { World } from '@/world/world';
import {
  FACES, MAX_FACES, buildChunkMesh, buildPaletteLinear, createMeshBuffers, hexToLinear, srgbToLinear,
} from '@/world/mesher';
import { GRASS_TOP_SLOT, TERRAIN_HEX, blockHex, blockName, oreHex, placeableFromInventory } from '@/world/blocks';

const palette = buildPaletteLinear(hexToLinear);
const out = createMeshBuffers();

function meshOf(world: World, cx = 0, cz = 0): number {
  return buildChunkMesh(world.getBlock, cx * CHUNK_W, cz * CHUNK_D, palette, out);
}

describe('FACES', () => {
  it('has six faces whose corner winding points along dir', () => {
    expect(FACES.length).toBe(6);
    for (const f of FACES) {
      const c0 = f.corners[0]!, c1 = f.corners[1]!, c2 = f.corners[2]!;
      const ax = c1[0] - c0[0], ay = c1[1] - c0[1], az = c1[2] - c0[2];
      const bx = c2[0] - c0[0], by = c2[1] - c0[1], bz = c2[2] - c0[2];
      const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
      const dot = n[0]! * f.dir[0] + n[1]! * f.dir[1] + n[2]! * f.dir[2];
      expect(dot).toBeGreaterThan(0);
    }
    expect(MAX_FACES).toBe(CHUNK_W * CHUNK_H * CHUNK_D * 6);
  });
});

describe('blocks (06 §2.2)', () => {
  it('oreHex fixtures', () => {
    expect(oreHex('C')).toBe(0x636569);
    expect(oreHex('N')).toBe(0x5b77bd);
    expect(oreHex('O')).toBe(0xb75a61);
    expect(oreHex('S')).toBe(0xbeb95b);
    expect(oreHex('F')).toBe(0x8db873);
    expect(oreHex('Cl')).toBe(0x55b05b);
    expect(oreHex('Br')).toBe(0x945559);
    expect(oreHex('I')).toBe(0x8f4895);
    expect(blockHex(Block.OreBr)).toBe(0x945559);
    expect(blockHex(Block.Stone)).toBe(TERRAIN_HEX[Block.Stone]);
    expect(blockHex(Block.AtomC)).toBe(0xff00ff);
  });
  it('blockName and placeability', () => {
    expect(blockName(Block.Stone)).toBe('Stone');
    expect(blockName(Block.OreC)).toBe('Carbon ore');
    expect(blockName(Block.AtomCl)).toBe('Chlorine atom');
    expect(blockName(Block.AtomH)).toBe('Hydrogen atom');
    expect(blockName(Block.LabTileEdge)).toBe('Lab tile edge');
    expect(placeableFromInventory(Block.AtomC)).toBe(true);
    expect(placeableFromInventory(Block.OreC)).toBe(false);
    expect(placeableFromInventory(Block.Stone)).toBe(false);
  });
});

describe('palette', () => {
  it('maps 0x808080 to ~0.2158 per channel', () => {
    expect(srgbToLinear(0x80)).toBeCloseTo(0.2158, 3);
    const lin = hexToLinear(0x808080);
    for (const c of lin) expect(c).toBeCloseTo(0.2158, 3);
  });
  it('fills slot 255 with the grass top and every block id with its hex', () => {
    expect(palette.length).toBe(256 * 3);
    const top = hexToLinear(0x5fae45);
    expect(palette[GRASS_TOP_SLOT * 3]).toBeCloseTo(top[0], 6);
    const stone = hexToLinear(blockHex(Block.Stone));
    expect(palette[Block.Stone * 3 + 2]).toBeCloseTo(stone[2], 6);
  });
});

describe('buildChunkMesh fixtures (06 §5.3)', () => {
  it('one Stone at (5,5,5): 6 faces, 24 vertices, 36 indices', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.Stone);
    const faces = meshOf(w);
    expect(faces).toBe(6);
    expect(faces * 4).toBe(24);
    expect(faces * 6).toBe(36);
    // the index buffer references only the 24 vertices written
    for (let i = 0; i < 36; i++) expect(out.idx[i]).toBeLessThan(24);
  });

  it('two adjacent Stones: 10 faces', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.Stone);
    w.setBlock(6, 5, 5, Block.Stone);
    expect(meshOf(w)).toBe(10);
  });

  it('Stone next to an atom: the atom emits nothing, the stone +x face is still emitted', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.Stone);
    w.setBlock(6, 5, 5, Block.AtomC);
    const faces = meshOf(w);
    expect(faces).toBe(6);
    // one of the faces has normal +x
    let plusX = 0;
    for (let f = 0; f < faces; f++) if (out.nor[f * 12] === 1) plusX++;
    expect(plusX).toBe(1);
  });

  it('Stone next to Glass: 11 faces (stone 6, glass 5)', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.Stone);
    w.setBlock(6, 5, 5, Block.Glass);
    expect(meshOf(w)).toBe(11);
  });

  it('Bedrock at (5,0,5): 5 faces (no -y face)', () => {
    const w = new World();
    w.setBlock(5, 0, 5, Block.Bedrock);
    const faces = meshOf(w);
    expect(faces).toBe(5);
    for (let f = 0; f < faces; f++) expect(out.nor[f * 12 + 1]).not.toBe(-1);
  });

  it('Grass colours: +y from slot 255 at shade 1, -y from slot 4 at shade 0.5', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.Grass);
    const faces = meshOf(w);
    expect(faces).toBe(6);
    for (let f = 0; f < faces; f++) {
      const ny = out.nor[f * 12 + 1];
      const r = out.col[f * 12]!;
      if (ny === 1) expect(r).toBeCloseTo(palette[GRASS_TOP_SLOT * 3]! * 1.0, 6);
      if (ny === -1) expect(r).toBeCloseTo(palette[Block.Grass * 3]! * 0.5, 6);
    }
  });

  it('a neighbour in the next chunk culls the +x face of (15,5,5)', () => {
    const w = new World();
    w.setBlock(15, 5, 5, Block.Stone);
    w.setBlock(16, 5, 5, Block.Stone);
    const faces = meshOf(w, 0, 0);
    expect(faces).toBe(5);
    for (let f = 0; f < faces; f++) expect(out.nor[f * 12]).not.toBe(1);
  });

  it('chunk (0,0) filled with Stone: 2304 faces, 9216 vertices, 13824 indices', () => {
    const w = new World();
    for (let y = 0; y < CHUNK_H; y++) for (let z = 0; z < CHUNK_D; z++) for (let x = 0; x < CHUNK_W; x++) w.setBlock(x, y, z, Block.Stone);
    const faces = meshOf(w);
    expect(faces).toBe(2304);
    expect(faces * 4).toBe(9216);
    expect(faces * 6).toBe(13824);
  });
});
