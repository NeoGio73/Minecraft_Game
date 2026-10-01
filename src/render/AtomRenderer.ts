/**
 * Atom blocks (one InstancedMesh per element), implicit-H studs, H mini-blocks
 * (pickable in select mode) and charge badges.
 * DOM/WebGL package (imports three). docs/design/06-engine.md §12.3.
 *
 * instanceColor is a diffuse multiplier (it can darken, never brighten), so it
 * is used only for the reactant-zone dim tint; target / hover / selection are
 * drawn by Highlight.ts shells.
 */
import { BoxGeometry, Color, Matrix4, MeshLambertMaterial, Sprite, SpriteMaterial, Vector3 } from 'three';
import type { InstancedMesh, Object3D } from 'three';
import { TARGET_VALENCE } from '../chem/types';
import { BLOCK_ELEMENTS, CPK_HEX, cellIndex } from '../world/types';
import type { BlockElement, CellKey, IndexedAtom, MoleculeIndex } from '../world/types';
import { implicitHCell } from '../world/extract';
import { makeGlyphTexture } from './element-texture';
import type { ElementTextures } from './element-texture';
import { InstancedPool, LAYER_NO_PICK, WHITE, cellCenter } from './Renderer';

export const ATOM_SCALE = 0.62;
export const EXPLICIT_H_SCALE = 0.55;
export const STUD_SIZE = 0.16;
export const STUD_OFFSET = 0.40;
export const H_BLOCK_SCALE = 0.4;
/** Per element; doubled (mesh recreated) when exceeded. */
export const INITIAL_CAPACITY = 1024;
/** Studs and H mini-blocks; doubled when exceeded. */
export const STUD_CAPACITY = 4096;
export const H_BLOCK_OPACITY: Readonly<Record<'blocks' | 'select', number>> = { blocks: 0.65, select: 1.0 };
/** Linear diffuse multiplier for reactant-zone (locked) atoms. */
export const GREY_DIM: Color = new Color(0.72, 0.72, 0.72);
export const BADGE_SCALE = 0.28;
export const BADGE_OFFSET_Y = 0.5;
export const BADGE_PLUS = 0xef5350;
export const BADGE_MINUS = 0x4a7bff;

export type HydrogenMode = 'studs' | 'blocks' | 'select';

/** hydrogenMode comes from hooks.setHydrogenMode (07 §1.3): 'studs' when !Settings.showHydrogens, 'blocks' when true,
 *  'select' forced by select-atom rules. dimCells = cells of State.locked placements whose zone is 'reactant'. */
export interface AtomView {
  readonly hydrogenMode: HydrogenMode;
  readonly dimCells: ReadonlySet<CellKey>;
}

export type GetBlock = (x: number, y: number, z: number) => number;

export interface HydrogenRef {
  readonly cell: CellKey;
  readonly slot: number;
}

/** Implicit hydrogens of an indexed heavy atom: max(0, targetValence - bondOrderSum). 0 for H blocks and unsupported charges. */
export function implicitHydrogenCount(index: MoleculeIndex, atom: IndexedAtom): number {
  if (atom.el === 'H') return 0;
  const tv = TARGET_VALENCE[atom.el][atom.charge];
  if (tv === undefined) return 0;
  return Math.max(0, tv - index.bondOrderSum(atom.key));
}

/** Explicit H blocks touching `key` (they come first in the hydrogen slot order). */
export function explicitHydrogenCount(index: MoleculeIndex, key: CellKey): number {
  let n = 0;
  for (const a of index.neighbours(key)) if (a.el === 'H') n++;
  return n;
}

/** index.atoms sorted by cellIndex so instance ids are stable for equal content. */
export function sortedAtoms(index: MoleculeIndex): IndexedAtom[] {
  return Array.from(index.atoms.values()).sort((p, q) => cellIndex(p.x, p.y, p.z) - cellIndex(q.x, q.y, q.z));
}

const _m = new Matrix4();
const _v = new Vector3();

export class AtomRenderer {
  private readonly parent: Object3D;
  private readonly pools: Map<BlockElement, InstancedPool> = new Map();
  private readonly geometries: BoxGeometry[] = [];
  private readonly materials: MeshLambertMaterial[] = [];
  private readonly studs: InstancedPool;
  private readonly studGeometry: BoxGeometry;
  private readonly studMaterial: MeshLambertMaterial;
  private readonly hPool: InstancedPool;
  private readonly hGeometry: BoxGeometry;
  private readonly hMaterial: MeshLambertMaterial;
  private hydrogenIds: HydrogenRef[] = [];
  private readonly badges: Sprite[] = [];
  private readonly plusMaterial: SpriteMaterial;
  private readonly minusMaterial: SpriteMaterial;
  private mode: HydrogenMode = 'studs';
  /** Counts after the last update (diagnostics, debug overlay). */
  atomCount = 0;
  studCount = 0;
  hydrogenCount = 0;

  constructor(parent: Object3D, textures: ElementTextures) {
    this.parent = parent;
    for (const el of BLOCK_ELEMENTS) {
      const geometry = new BoxGeometry(el === 'H' ? EXPLICIT_H_SCALE : ATOM_SCALE, el === 'H' ? EXPLICIT_H_SCALE : ATOM_SCALE, el === 'H' ? EXPLICIT_H_SCALE : ATOM_SCALE);
      const material = new MeshLambertMaterial({ map: textures.get(el), color: 0xffffff });
      material.name = `atom-${el}`;
      this.geometries.push(geometry);
      this.materials.push(material);
      this.pools.set(el, new InstancedPool(parent, geometry, material, INITIAL_CAPACITY, { useColor: true, name: `atoms-${el}` }));
    }
    this.studGeometry = new BoxGeometry(STUD_SIZE, STUD_SIZE, STUD_SIZE);
    this.studMaterial = new MeshLambertMaterial({ color: CPK_HEX.H });
    this.studMaterial.name = 'studs';
    this.studs = new InstancedPool(parent, this.studGeometry, this.studMaterial, STUD_CAPACITY, { layer: LAYER_NO_PICK, name: 'studs' });
    this.hGeometry = new BoxGeometry(H_BLOCK_SCALE, H_BLOCK_SCALE, H_BLOCK_SCALE);
    this.hMaterial = new MeshLambertMaterial({ map: textures.get('H'), transparent: true, opacity: H_BLOCK_OPACITY.blocks });
    this.hMaterial.name = 'h-blocks';
    this.hPool = new InstancedPool(parent, this.hGeometry, this.hMaterial, STUD_CAPACITY, { visible: false, name: 'h-blocks' });
    this.plusMaterial = new SpriteMaterial({ map: makeGlyphTexture('+', BADGE_PLUS, 0xffffff), depthWrite: false, transparent: true });
    this.minusMaterial = new SpriteMaterial({ map: makeGlyphTexture('−', BADGE_MINUS, 0xffffff), depthWrite: false, transparent: true });
  }

  /** Mini-block mesh (select mode); pickable. Re-read it every frame: the mesh is recreated when its capacity doubles. */
  get hydrogenMesh(): InstancedMesh {
    return this.hPool.mesh;
  }

  /** Current hydrogen display mode (after the last update). */
  get hydrogenMode(): HydrogenMode {
    return this.mode;
  }

  /** Rebuilds every instance from the index (idempotent; runs after any world edit or view change). */
  update(index: MoleculeIndex, view: AtomView, getBlock: GetBlock): void {
    this.mode = view.hydrogenMode;
    for (const pool of this.pools.values()) pool.begin();
    this.studs.begin();
    this.hPool.begin();
    this.hydrogenIds = [];
    let badge = 0;
    const atoms = sortedAtoms(index);
    for (const atom of atoms) {
      const pool = this.pools.get(atom.el) as InstancedPool;
      _m.makeTranslation(atom.x + 0.5, atom.y + 0.5, atom.z + 0.5);
      pool.push(_m, view.dimCells.has(atom.key) ? GREY_DIM : WHITE);

      if (atom.charge !== 0) {
        const sprite = this.badge(badge++);
        sprite.material = atom.charge > 0 ? this.plusMaterial : this.minusMaterial;
        sprite.position.set(atom.x + 0.5, atom.y + 0.5 + BADGE_OFFSET_Y, atom.z + 0.5);
        sprite.visible = true;
      }

      if (atom.el === 'H') continue;
      const nH = implicitHydrogenCount(index, atom);
      if (nH === 0) continue;
      const explicit = explicitHydrogenCount(index, atom.key);
      for (let k = 0; k < nH; k++) {
        const c = implicitHCell(getBlock, atom.x, atom.y, atom.z, k);
        if (c === null) break;
        if (view.hydrogenMode === 'studs') {
          _m.makeTranslation(
            atom.x + 0.5 + (c[0] - atom.x) * STUD_OFFSET,
            atom.y + 0.5 + (c[1] - atom.y) * STUD_OFFSET,
            atom.z + 0.5 + (c[2] - atom.z) * STUD_OFFSET,
          );
          this.studs.push(_m);
        } else {
          _m.makeTranslation(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5);
          this.hPool.push(_m);
          this.hydrogenIds.push({ cell: atom.key, slot: explicit + k });
        }
      }
    }
    for (let i = badge; i < this.badges.length; i++) (this.badges[i] as Sprite).visible = false;
    for (const pool of this.pools.values()) pool.end();
    this.studs.end();
    this.hPool.end();
    const blocksMode = view.hydrogenMode !== 'studs';
    this.studs.visible = !blocksMode;
    this.hPool.visible = blocksMode;
    this.hMaterial.opacity = view.hydrogenMode === 'select' ? H_BLOCK_OPACITY.select : H_BLOCK_OPACITY.blocks;
    this.atomCount = atoms.length;
    this.studCount = this.studs.count;
    this.hydrogenCount = this.hPool.count;
  }

  private badge(i: number): Sprite {
    let s = this.badges[i];
    if (!s) {
      s = new Sprite(this.plusMaterial);
      s.scale.set(BADGE_SCALE, BADGE_SCALE, 1);
      s.name = 'charge-badge';
      this.parent.add(s);
      this.badges.push(s);
    }
    return s;
  }

  /** Parent cell and hydrogen slot of a mini-block instance (explicit blocks first in slot order). */
  hydrogenOf(instanceId: number): HydrogenRef | null {
    return this.hydrogenIds[instanceId] ?? null;
  }

  /** World centre of mini-block instance `id` (select-atom picking helpers). */
  hydrogenCenter(instanceId: number, out = new Vector3()): Vector3 | null {
    if (instanceId < 0 || instanceId >= this.hPool.count) return null;
    this.hPool.mesh.getMatrixAt(instanceId, _m);
    _v.setFromMatrixPosition(_m);
    return out.copy(_v);
  }

  /** Centre of the atom block at cell (x, y, z). */
  static center(x: number, y: number, z: number, out = new Vector3()): Vector3 {
    return cellCenter(x, y, z, out);
  }

  dispose(): void {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.studs.dispose();
    this.studGeometry.dispose();
    this.studMaterial.dispose();
    this.hPool.dispose();
    this.hGeometry.dispose();
    this.hMaterial.dispose();
    for (const s of this.badges) this.parent.remove(s);
    this.badges.length = 0;
    this.plusMaterial.dispose();
    this.minusMaterial.dispose();
    this.hydrogenIds = [];
  }
}
