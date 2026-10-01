/**
 * Bond bars, bond-order glyphs, the invisible pick mesh and the break markers
 * of suppressed ("no bond") pairs.
 * DOM/WebGL package (imports three). docs/design/06-engine.md §12.4;
 * 09-amendment-no-bond.md §5.2.
 *
 * Pick mesh: `visible = false` (never drawn, no transparent sorting) but still
 * raycast — the Raycaster tests layers, never `visible`. One instance per bond
 * (sorted by PairKey) followed by one per suppressed pair (sorted by PairKey),
 * so `pairOf(instanceId)` resolves both kinds and ids are stable for equal
 * content.
 */
import { BoxGeometry, Color, Matrix4, MeshBasicMaterial, MeshLambertMaterial, Quaternion, Sprite, SpriteMaterial, Vector3 } from 'three';
import type { InstancedMesh, Material, Object3D } from 'three';
import type { BondOrder } from '../chem/types';
import { parseCellKey, splitPairKey } from '../world/types';
import type { PairKey } from '../world/types';
import type { MoleculeIndexExt } from '../world/molecule-index';
import { BREAK_MARKER_RED, breakTexture, makeGlyphTexture } from './element-texture';
import { InstancedPool, WHITE } from './Renderer';

export const BAR_W = 0.11;
export const BAR_W_MULTI = 0.08;
export const BAR_LEN = 1.0;
export const OFFSET_2 = 0.13;
export const OFFSET_3 = 0.17;
export const PICK_W = 0.3;
export const BOND_GREY = 0x9a9a9a;
export const BOND_WARN = 0xef5350;
/** Break marker (09 §5.2): a thin red plate with a white "x" at the pair midpoint. */
export const BREAK_SIZE = 0.44;
export const BREAK_THICK = 0.04;
export const BREAK_RED = BREAK_MARKER_RED;
export const BAR_CAPACITY = 4096;
export const MARKER_CAPACITY = 256;
export const GLYPH_SCALE = 0.22;
export const GLYPH_OFFSET_Y = 0.32;
export const GLYPH_DISC = 0x101418;

const PLUS_Z = new Vector3(0, 0, 1);
const PLUS_X = new Vector3(1, 0, 0);
const PLUS_Y = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);
const GREY = new Color(BOND_GREY);
const WARN = new Color(BOND_WARN);

/** Geometry frame of a pair: midpoint, unit axis a -> b, the perpendicular used for multi-bar offsets, and the quaternion +Z -> axis. */
export interface BondFrame {
  readonly mid: Vector3;
  readonly axis: Vector3;
  readonly perp: Vector3;
  readonly quaternion: Quaternion;
}

/** Frame for two world points (cell centres or ghost positions). perp = +x when the axis is ±y, else +y. */
export function bondFrame(a: Vector3, b: Vector3, out?: BondFrame): BondFrame {
  const f = out ?? { mid: new Vector3(), axis: new Vector3(), perp: new Vector3(), quaternion: new Quaternion() };
  f.mid.copy(a).add(b).multiplyScalar(0.5);
  f.axis.copy(b).sub(a);
  const len = f.axis.length();
  if (len > 0) f.axis.divideScalar(len);
  else f.axis.set(0, 0, 1);
  const isY = Math.abs(f.axis.y) > 0.999;
  f.perp.copy(isY ? PLUS_X : PLUS_Y);
  // keep perp orthogonal to the axis for non-lattice (stick) directions
  const d = f.perp.dot(f.axis);
  if (Math.abs(d) > 1e-6) {
    f.perp.addScaledVector(f.axis, -d);
    if (f.perp.lengthSq() < 1e-12) f.perp.copy(PLUS_X).addScaledVector(f.axis, -f.perp.dot(f.axis));
    f.perp.normalize();
  }
  f.quaternion.setFromUnitVectors(PLUS_Z, f.axis);
  return f;
}

/** Bar centre offsets (along perp) per order: 1 -> [0], 2 -> [-0.13, +0.13], 3 -> [-0.17, 0, +0.17]. */
export function barOffsets(order: number): readonly number[] {
  if (order >= 3) return [-OFFSET_3, 0, OFFSET_3];
  if (order === 2) return [-OFFSET_2, OFFSET_2];
  return [0];
}

export function barWidth(order: number): number {
  return order === 1 ? BAR_W : BAR_W_MULTI;
}

/** Cell centres of the two cells of a PairKey. */
export function pairCenters(key: PairKey, outA = new Vector3(), outB = new Vector3()): [Vector3, Vector3] {
  const [ka, kb] = splitPairKey(key);
  const a = parseCellKey(ka);
  const b = parseCellKey(kb);
  outA.set(a[0] + 0.5, a[1] + 0.5, a[2] + 0.5);
  outB.set(b[0] + 0.5, b[1] + 0.5, b[2] + 0.5);
  return [outA, outB];
}

/** Six-entry material array for the break plate: the two ±z faces carry the "x" texture, the four edges are plain red. */
export function makeBreakMaterials(opts: { transparent?: boolean; opacity?: number; depthWrite?: boolean } = {}): Material[] {
  const face = new MeshLambertMaterial({ map: breakTexture() });
  const edge = new MeshLambertMaterial({ color: BREAK_RED });
  for (const m of [face, edge]) {
    if (opts.transparent) {
      m.transparent = true;
      m.opacity = opts.opacity ?? 1;
    }
    if (opts.depthWrite !== undefined) m.depthWrite = opts.depthWrite;
  }
  face.name = 'break-face';
  edge.name = 'break-edge';
  // BoxGeometry group order: +x, -x, +y, -y, +z, -z
  return [edge, edge, edge, edge, face, face];
}

export function makeBreakGeometry(): BoxGeometry {
  return new BoxGeometry(BREAK_SIZE, BREAK_SIZE, BREAK_THICK);
}

export function makeBarGeometry(): BoxGeometry {
  return new BoxGeometry(1, 1, BAR_LEN);
}

function comparePairKeys(a: PairKey, b: PairKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const _frame: BondFrame = { mid: new Vector3(), axis: new Vector3(), perp: new Vector3(), quaternion: new Quaternion() };
const _a = new Vector3();
const _b = new Vector3();
const _p = new Vector3();
const _s = new Vector3();
const _m = new Matrix4();

export class BondRenderer {
  private readonly parent: Object3D;
  private readonly barGeometry: BoxGeometry;
  private readonly barMaterial: MeshLambertMaterial;
  private readonly bars: InstancedPool;
  private readonly pickGeometry: BoxGeometry;
  private readonly pickMaterial: MeshBasicMaterial;
  private readonly pick: InstancedPool;
  private readonly markerGeometry: BoxGeometry;
  private readonly markerMaterials: Material[];
  private readonly markers: InstancedPool;
  private readonly glyphs: Sprite[] = [];
  private readonly glyphMaterials: Record<2 | 3, SpriteMaterial>;
  private pairs: PairKey[] = [];
  /** Counts after the last update (diagnostics). */
  bondCount = 0;
  markerCount = 0;

  constructor(parent: Object3D) {
    this.parent = parent;
    this.barGeometry = makeBarGeometry();
    this.barMaterial = new MeshLambertMaterial({ color: 0xffffff });
    this.barMaterial.name = 'bars';
    this.bars = new InstancedPool(parent, this.barGeometry, this.barMaterial, BAR_CAPACITY, { useColor: true, name: 'bars' });
    this.pickGeometry = new BoxGeometry(PICK_W, PICK_W, BAR_LEN);
    this.pickMaterial = new MeshBasicMaterial();
    this.pickMaterial.name = 'bond-pick';
    this.pick = new InstancedPool(parent, this.pickGeometry, this.pickMaterial, BAR_CAPACITY, { visible: false, name: 'bond-pick' });
    this.markerGeometry = makeBreakGeometry();
    this.markerMaterials = makeBreakMaterials();
    this.markers = new InstancedPool(parent, this.markerGeometry, this.markerMaterials, MARKER_CAPACITY, { name: 'break-markers' });
    this.glyphMaterials = {
      2: new SpriteMaterial({ map: makeGlyphTexture('2', GLYPH_DISC, 0xffffff), depthWrite: false, transparent: true }),
      3: new SpriteMaterial({ map: makeGlyphTexture('3', GLYPH_DISC, 0xffffff), depthWrite: false, transparent: true }),
    };
  }

  /** Invisible pick mesh: one instance per bond, then one per suppressed pair. Re-read it every frame (capacity doubling recreates it). */
  get pickMesh(): InstancedMesh {
    return this.pick.mesh;
  }

  /** Break-marker mesh (one instance per suppressed pair). */
  get markerMesh(): InstancedMesh {
    return this.markers.mesh;
  }

  /**
   * Rebuilds bars, glyphs, pick instances and break markers from the index.
   * `warnPairs` = double bonds whose stereo label is COLLINEAR / NOT_PLANAR / TWISTED (tinted BOND_WARN);
   * `showGlyphs` = bond wand active (order glyphs "2"/"3" shown).
   */
  update(index: MoleculeIndexExt, warnPairs: ReadonlySet<PairKey>, showGlyphs: boolean): void {
    this.bars.begin();
    this.pick.begin();
    this.markers.begin();
    const pairs: PairKey[] = [];
    let glyph = 0;

    const bondKeys = Array.from(index.bonds.keys()).sort(comparePairKeys);
    for (const key of bondKeys) {
      const bond = index.bonds.get(key);
      if (!bond) continue;
      pairCenters(key, _a, _b);
      bondFrame(_a, _b, _frame);
      const order: BondOrder = bond.order;
      const w = barWidth(order);
      const colour = warnPairs.has(key) ? WARN : GREY;
      for (const off of barOffsets(order)) {
        _p.copy(_frame.mid).addScaledVector(_frame.perp, off);
        _s.set(w, w, 1);
        _m.compose(_p, _frame.quaternion, _s);
        this.bars.push(_m, colour);
      }
      _m.compose(_frame.mid, _frame.quaternion, ONE);
      this.pick.push(_m);
      pairs.push(key);
      if (showGlyphs && order > 1) {
        const sprite = this.glyph(glyph++);
        sprite.material = this.glyphMaterials[order as 2 | 3];
        sprite.position.set(_frame.mid.x, _frame.mid.y + GLYPH_OFFSET_Y, _frame.mid.z);
        sprite.visible = true;
      }
    }

    const suppressedKeys = Array.from(index.suppressed).sort(comparePairKeys);
    for (const key of suppressedKeys) {
      pairCenters(key, _a, _b);
      bondFrame(_a, _b, _frame);
      _m.compose(_frame.mid, _frame.quaternion, ONE);
      this.markers.push(_m);
      this.pick.push(_m);
      pairs.push(key);
    }

    for (let i = glyph; i < this.glyphs.length; i++) (this.glyphs[i] as Sprite).visible = false;
    this.bars.end();
    this.pick.end();
    this.markers.end();
    this.pairs = pairs;
    this.bondCount = bondKeys.length;
    this.markerCount = suppressedKeys.length;
  }

  private glyph(i: number): Sprite {
    let s = this.glyphs[i];
    if (!s) {
      s = new Sprite(this.glyphMaterials[2]);
      s.scale.set(GLYPH_SCALE, GLYPH_SCALE, 1);
      s.name = 'bond-glyph';
      this.parent.add(s);
      this.glyphs.push(s);
    }
    return s;
  }

  /** PairKey of a pick-mesh instance: a bond (ids 0..bondCount-1) or a suppressed pair (the rest). */
  pairOf(instanceId: number): PairKey | null {
    return this.pairs[instanceId] ?? null;
  }

  /** true when the pick instance is a break marker (suppressed pair). */
  isMarkerInstance(instanceId: number): boolean {
    return instanceId >= this.bondCount && instanceId < this.pairs.length;
  }

  dispose(): void {
    this.bars.dispose();
    this.pick.dispose();
    this.markers.dispose();
    this.barGeometry.dispose();
    this.barMaterial.dispose();
    this.pickGeometry.dispose();
    this.pickMaterial.dispose();
    this.markerGeometry.dispose();
    for (const m of new Set(this.markerMaterials)) m.dispose();
    for (const s of this.glyphs) this.parent.remove(s);
    this.glyphs.length = 0;
    this.glyphMaterials[2].dispose();
    this.glyphMaterials[3].dispose();
    this.pairs = [];
  }
}

export { WHITE as BAR_BASE_COLOR };
