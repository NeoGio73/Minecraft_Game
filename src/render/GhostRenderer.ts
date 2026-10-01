/**
 * Translucent previews: bench ghost builds (blocks, bars, break markers, badges),
 * the ball-and-stick fallback for odd rings, and the enantiomer mirror ghost.
 * Nothing here is pickable or solid.
 * DOM/WebGL package (imports three). docs/design/06-engine.md §12.5;
 * 04-reaction-bench.md §7.2, §7.4; 09-amendment-no-bond.md §5.3.
 */
import { BoxGeometry, Color, Group, Matrix4, MeshLambertMaterial, Quaternion, SphereGeometry, Sprite, SpriteMaterial, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import type { MoleculeGraph, Vec3 } from '../chem/types';
import { BLOCK_ELEMENTS, CPK_HEX, cellKey, parseCellKey } from '../world/types';
import type { BlockElement, CellKey } from '../world/types';
import { ATOM_SCALE, BADGE_MINUS, BADGE_OFFSET_Y, BADGE_PLUS, BADGE_SCALE, EXPLICIT_H_SCALE } from './AtomRenderer';
import { BOND_GREY, barOffsets, barWidth, bondFrame, makeBarGeometry, makeBreakGeometry, makeBreakMaterials } from './BondRenderer';
import type { BondFrame } from './BondRenderer';
import { makeGlyphTexture } from './element-texture';
import type { ElementTextures } from './element-texture';
import { InstancedPool, WHITE } from './Renderer';

export const GHOST_OPACITY = 0.35;
export const GHOST_BADGE_OPACITY = 0.6;
export const STICK_SPHERE_RADIUS = 0.22;
export const STICK_SCALE = 0.9;
export const STICK_CENTER: Vec3 = [70, 12, 42];
/** rad/s about +y (0 under reduced motion). */
export const STICK_SPIN = 0.3;
export const MIRROR_MS = 8000;
/** PRODUCT_MAX - PRODUCT_MIN + 1 (04 §7.2): a lattice ghost larger than this falls back to sticks. */
export const PRODUCT_ZONE_EXTENT: Vec3 = [10, 21, 10];
/** Empty columns between side-by-side previews (fragments / mixture alternatives). */
export const PREVIEW_GAP = 2;
export const GHOST_CAPACITY = 256;

/** One bench preview (State.bench.previews[k], 04 §1 + 09 §1.8 suppressedPairs). */
export interface GhostPreview {
  readonly graph: MoleculeGraph;
  /** pos[atomId] for every heavy atom (lattice cells, or the relaxed layout when !buildable). */
  readonly pos: readonly Vec3[];
  /** Explicit H cells per parent atom id. */
  readonly hPos: ReadonlyMap<number, readonly Vec3[]>;
  /** Heavy-atom id pairs that touch but must not bond (break markers). */
  readonly suppressedPairs?: readonly (readonly [number, number])[];
  /** false = relaxed layout (odd rings): drawn as sticks. Default true. */
  readonly buildable?: boolean;
}

export interface MirrorCell {
  readonly cell: CellKey;
  readonly el: BlockElement;
}

/** What a ghost cell holds (for hover text, 09 §5.3 STRINGS.targetGhostBreak). */
export interface GhostCellInfo {
  readonly el: BlockElement;
  /** Preview index and atom id (-1 for an explicit H ghost). */
  readonly preview: number;
  readonly atom: number;
  readonly hydrogen: boolean;
  /** true when the cell is an endpoint of a ghost suppressed pair. */
  readonly breakEndpoint: boolean;
}

interface BlockItem { readonly el: BlockElement; readonly x: number; readonly y: number; readonly z: number }
interface BarItem { readonly a: Vector3; readonly b: Vector3; readonly order: number }
interface MarkerItem { readonly a: Vector3; readonly b: Vector3 }
interface BadgeItem { readonly x: number; readonly y: number; readonly z: number; readonly charge: number }

function isBlockElement(el: string): el is BlockElement {
  return (BLOCK_ELEMENTS as readonly string[]).includes(el);
}

function minMax(points: readonly Vec3[]): { min: Vec3; max: Vec3 } | null {
  if (points.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      const v = p[i] as number;
      if (v < (min[i] as number)) min[i] = v;
      if (v > (max[i] as number)) max[i] = v;
    }
  }
  return { min, max };
}

/** Translates pos ∪ hPos so that their bounding-box minimum equals `anchor` (idempotent for an already-anchored preview). */
export function translatePreview(preview: GhostPreview, anchor: Vec3): { pos: Vec3[]; hPos: Map<number, Vec3[]>; extent: Vec3 } {
  const all: Vec3[] = [...preview.pos];
  for (const list of preview.hPos.values()) all.push(...list);
  const mm = minMax(all);
  const d: Vec3 = mm ? [anchor[0] - mm.min[0], anchor[1] - mm.min[1], anchor[2] - mm.min[2]] : [0, 0, 0];
  const shift = (p: Vec3): Vec3 => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  const pos = preview.pos.map(shift);
  const hPos = new Map<number, Vec3[]>();
  for (const [id, list] of preview.hPos) hPos.set(id, list.map(shift));
  const extent: Vec3 = mm ? [mm.max[0] - mm.min[0] + 1, mm.max[1] - mm.min[1] + 1, mm.max[2] - mm.min[2] + 1] : [0, 0, 0];
  return { pos, hPos, extent };
}

export function fitsProductZone(extent: Vec3): boolean {
  return extent[0] <= PRODUCT_ZONE_EXTENT[0] && extent[1] <= PRODUCT_ZONE_EXTENT[1] && extent[2] <= PRODUCT_ZONE_EXTENT[2];
}

const _frame: BondFrame = { mid: new Vector3(), axis: new Vector3(), perp: new Vector3(), quaternion: new Quaternion() };
const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const ONE = new Vector3(1, 1, 1);

export class GhostRenderer {
  private readonly parent: Object3D;
  private readonly blockPools: Map<BlockElement, InstancedPool> = new Map();
  private readonly ownedGeometries: { dispose(): void }[] = [];
  private readonly ownedMaterials: Material[] = [];
  private readonly bars: InstancedPool;
  private readonly markers: InstancedPool;
  private readonly badges: Sprite[] = [];
  private readonly plusMaterial: SpriteMaterial;
  private readonly minusMaterial: SpriteMaterial;
  private readonly stickGroup: Group;
  private readonly stickSpheres: InstancedPool;
  private readonly stickBars: InstancedPool;

  private previewBlocks: BlockItem[] = [];
  private previewBars: BarItem[] = [];
  private previewMarkers: MarkerItem[] = [];
  private previewBadges: BadgeItem[] = [];
  private cellInfo: Map<CellKey, GhostCellInfo> = new Map();
  private mirrorBlocks: BlockItem[] = [];
  private mirrorRemainingMs = 0;
  private sticksVisible = false;

  constructor(parent: Object3D, textures: ElementTextures) {
    this.parent = parent;
    for (const el of BLOCK_ELEMENTS) {
      const s = el === 'H' ? EXPLICIT_H_SCALE : ATOM_SCALE;
      const geometry = new BoxGeometry(s, s, s);
      const material = new MeshLambertMaterial({ map: textures.get(el), transparent: true, opacity: GHOST_OPACITY, depthWrite: false });
      material.name = `ghost-${el}`;
      this.ownedGeometries.push(geometry);
      this.ownedMaterials.push(material);
      this.blockPools.set(el, new InstancedPool(parent, geometry, material, GHOST_CAPACITY, { name: `ghost-${el}` }));
    }
    const barGeometry = makeBarGeometry();
    const barMaterial = new MeshLambertMaterial({ color: BOND_GREY, transparent: true, opacity: GHOST_OPACITY, depthWrite: false });
    barMaterial.name = 'ghost-bars';
    this.ownedGeometries.push(barGeometry);
    this.ownedMaterials.push(barMaterial);
    this.bars = new InstancedPool(parent, barGeometry, barMaterial, GHOST_CAPACITY, { name: 'ghost-bars' });
    const markerGeometry = makeBreakGeometry();
    const markerMaterials = makeBreakMaterials({ transparent: true, opacity: GHOST_OPACITY, depthWrite: false });
    this.ownedGeometries.push(markerGeometry);
    for (const m of new Set(markerMaterials)) this.ownedMaterials.push(m);
    this.markers = new InstancedPool(parent, markerGeometry, markerMaterials, 64, { name: 'ghost-break-markers' });
    this.plusMaterial = new SpriteMaterial({ map: makeGlyphTexture('+', BADGE_PLUS, 0xffffff), depthWrite: false, transparent: true, opacity: GHOST_BADGE_OPACITY });
    this.minusMaterial = new SpriteMaterial({ map: makeGlyphTexture('−', BADGE_MINUS, 0xffffff), depthWrite: false, transparent: true, opacity: GHOST_BADGE_OPACITY });

    this.stickGroup = new Group();
    this.stickGroup.name = 'sticks';
    this.stickGroup.position.set(STICK_CENTER[0], STICK_CENTER[1], STICK_CENTER[2]);
    this.stickGroup.visible = false;
    parent.add(this.stickGroup);
    const sphereGeometry = new SphereGeometry(STICK_SPHERE_RADIUS, 12, 8);
    const sphereMaterial = new MeshLambertMaterial({ color: 0xffffff });
    sphereMaterial.name = 'stick-spheres';
    this.ownedGeometries.push(sphereGeometry);
    this.ownedMaterials.push(sphereMaterial);
    this.stickSpheres = new InstancedPool(this.stickGroup, sphereGeometry, sphereMaterial, 64, { useColor: true, name: 'stick-spheres' });
    const stickBarGeometry = new BoxGeometry(1, 1, 1);
    const stickBarMaterial = new MeshLambertMaterial({ color: BOND_GREY });
    stickBarMaterial.name = 'stick-bars';
    this.ownedGeometries.push(stickBarGeometry);
    this.ownedMaterials.push(stickBarMaterial);
    this.stickBars = new InstancedPool(this.stickGroup, stickBarGeometry, stickBarMaterial, 64, { name: 'stick-bars' });
  }

  /**
   * Shows the bench previews as ghost blocks anchored at `anchor` (PRODUCT_MIN).
   * Previews are laid side by side along +x (PREVIEW_GAP empty columns apart).
   * A preview that is not buildable, or whose extent exceeds the product zone,
   * is drawn as sticks instead. Replaces the previous preview; keeps the mirror.
   */
  showGhost(previews: readonly GhostPreview[], anchor: Vec3): void {
    this.previewBlocks = [];
    this.previewBars = [];
    this.previewMarkers = [];
    this.previewBadges = [];
    this.cellInfo = new Map();
    let sticks: { graph: MoleculeGraph; pos: readonly Vec3[] } | null = null;
    let cursorX = anchor[0];
    for (let k = 0; k < previews.length; k++) {
      const preview = previews[k] as GhostPreview;
      const t = translatePreview(preview, [cursorX, anchor[1], anchor[2]]);
      const overflowX = cursorX + t.extent[0] - anchor[0] > PRODUCT_ZONE_EXTENT[0];
      if (preview.buildable === false || !fitsProductZone(t.extent) || overflowX) {
        if (sticks === null) sticks = { graph: preview.graph, pos: preview.pos };
        continue;
      }
      this.addLatticeGhost(k, preview, t.pos, t.hPos);
      cursorX += t.extent[0] + PREVIEW_GAP;
    }
    if (sticks !== null) this.setSticks(sticks.graph, sticks.pos);
    else this.hideSticks();
    this.rebuild();
  }

  private addLatticeGhost(k: number, preview: GhostPreview, pos: readonly Vec3[], hPos: ReadonlyMap<number, readonly Vec3[]>): void {
    const g = preview.graph;
    const breakEnds = new Set<number>();
    for (const [a, b] of preview.suppressedPairs ?? []) {
      breakEnds.add(a);
      breakEnds.add(b);
    }
    g.atoms.forEach((atom, id) => {
      const p = pos[id];
      if (!p || !isBlockElement(atom.el)) return;
      const el = atom.el;
      this.previewBlocks.push({ el, x: p[0], y: p[1], z: p[2] });
      this.cellInfo.set(cellKey(p[0], p[1], p[2]), { el, preview: k, atom: id, hydrogen: false, breakEndpoint: breakEnds.has(id) });
      if (atom.charge !== 0) this.previewBadges.push({ x: p[0], y: p[1], z: p[2], charge: atom.charge });
      for (const h of hPos.get(id) ?? []) {
        this.previewBlocks.push({ el: 'H', x: h[0], y: h[1], z: h[2] });
        this.cellInfo.set(cellKey(h[0], h[1], h[2]), { el: 'H', preview: k, atom: id, hydrogen: true, breakEndpoint: false });
        this.previewBars.push({ a: centerOf(p), b: centerOf(h), order: 1 });
      }
    });
    for (const bond of g.bonds) {
      const pa = pos[bond.a];
      const pb = pos[bond.b];
      if (!pa || !pb) continue;
      this.previewBars.push({ a: centerOf(pa), b: centerOf(pb), order: bond.order });
    }
    for (const [a, b] of preview.suppressedPairs ?? []) {
      const pa = pos[a];
      const pb = pos[b];
      if (!pa || !pb) continue;
      this.previewMarkers.push({ a: centerOf(pa), b: centerOf(pb) });
    }
  }

  /** Ball-and-stick preview of `graph` at `pos` (relaxed layout), replacing any lattice ghost. */
  showSticks(graph: MoleculeGraph, pos: readonly Vec3[]): void {
    this.previewBlocks = [];
    this.previewBars = [];
    this.previewMarkers = [];
    this.previewBadges = [];
    this.cellInfo = new Map();
    this.setSticks(graph, pos);
    this.rebuild();
  }

  private setSticks(graph: MoleculeGraph, pos: readonly Vec3[]): void {
    const n = Math.min(graph.atoms.length, pos.length);
    const centroid: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const p = pos[i] as Vec3;
      centroid[0] += p[0] / n;
      centroid[1] += p[1] / n;
      centroid[2] += p[2] / n;
    }
    const local = (p: Vec3): Vector3 => new Vector3((p[0] - centroid[0]) * STICK_SCALE, (p[1] - centroid[1]) * STICK_SCALE, (p[2] - centroid[2]) * STICK_SCALE);
    this.stickSpheres.begin();
    this.stickBars.begin();
    const colour = new Color();
    for (let i = 0; i < n; i++) {
      const atom = graph.atoms[i];
      const p = pos[i];
      if (!atom || !p) continue;
      const c = local(p);
      _m.makeTranslation(c.x, c.y, c.z);
      colour.setHex(CPK_HEX[atom.el]);
      this.stickSpheres.push(_m, colour);
    }
    for (const bond of graph.bonds) {
      const pa = pos[bond.a];
      const pb = pos[bond.b];
      if (!pa || !pb) continue;
      const a = local(pa);
      const b = local(pb);
      const dist = a.distanceTo(b);
      if (dist === 0) continue;
      bondFrame(a, b, _frame);
      const w = barWidth(bond.order) * STICK_SCALE;
      for (const off of barOffsets(bond.order)) {
        _p.copy(_frame.mid).addScaledVector(_frame.perp, off * STICK_SCALE);
        _s.set(w, w, dist);
        _m.compose(_p, _frame.quaternion, _s);
        this.stickBars.push(_m);
      }
    }
    this.stickSpheres.end();
    this.stickBars.end();
    this.stickGroup.visible = true;
    this.sticksVisible = true;
  }

  private hideSticks(): void {
    this.stickSpheres.begin();
    this.stickSpheres.end();
    this.stickBars.begin();
    this.stickBars.end();
    this.stickGroup.visible = false;
    this.sticksVisible = false;
  }

  /** Enantiomer feedback: the cells reflected through x' = 2*maxX + 3 - x, shown for MIRROR_MS or until clearMirror(). */
  showMirror(cells: readonly MirrorCell[]): void {
    let maxX = -Infinity;
    const parsed = cells.map((c) => ({ el: c.el, p: parseCellKey(c.cell) }));
    for (const c of parsed) if (c.p[0] > maxX) maxX = c.p[0];
    this.mirrorBlocks = parsed.map((c) => ({ el: c.el, x: 2 * maxX + 3 - c.p[0], y: c.p[1], z: c.p[2] }));
    this.mirrorRemainingMs = this.mirrorBlocks.length > 0 ? MIRROR_MS : 0;
    this.rebuild();
  }

  clearMirror(): void {
    if (this.mirrorBlocks.length === 0) return;
    this.mirrorBlocks = [];
    this.mirrorRemainingMs = 0;
    this.rebuild();
  }

  /** Removes the bench preview (ghost or sticks); keeps the mirror. */
  clearPreview(): void {
    this.previewBlocks = [];
    this.previewBars = [];
    this.previewMarkers = [];
    this.previewBadges = [];
    this.cellInfo = new Map();
    this.hideSticks();
    this.rebuild();
  }

  /** Removes everything. */
  clear(): void {
    this.mirrorBlocks = [];
    this.mirrorRemainingMs = 0;
    this.clearPreview();
  }

  /** Lattice-ghost content of a cell (null for empty cells, sticks and the mirror). */
  ghostCellInfo(key: CellKey): GhostCellInfo | null {
    return this.cellInfo.get(key) ?? null;
  }

  get hasPreview(): boolean {
    return this.previewBlocks.length > 0 || this.sticksVisible;
  }

  get hasMirror(): boolean {
    return this.mirrorBlocks.length > 0;
  }

  /** Per frame: spins the sticks (unless reduced motion) and expires the mirror ghost. */
  tick(dtSeconds: number, reducedMotion: boolean): void {
    if (this.sticksVisible && !reducedMotion && dtSeconds > 0) {
      this.stickGroup.rotation.y = (this.stickGroup.rotation.y + STICK_SPIN * dtSeconds) % (Math.PI * 2);
    }
    if (this.mirrorRemainingMs > 0) {
      this.mirrorRemainingMs -= dtSeconds * 1000;
      if (this.mirrorRemainingMs <= 0) this.clearMirror();
    }
  }

  private rebuild(): void {
    for (const pool of this.blockPools.values()) pool.begin();
    this.bars.begin();
    this.markers.begin();
    const place = (item: BlockItem): void => {
      _m.makeTranslation(item.x + 0.5, item.y + 0.5, item.z + 0.5);
      (this.blockPools.get(item.el) as InstancedPool).push(_m);
    };
    for (const item of this.previewBlocks) place(item);
    for (const item of this.mirrorBlocks) place(item);
    for (const bar of this.previewBars) {
      bondFrame(bar.a, bar.b, _frame);
      const w = barWidth(bar.order);
      const dist = bar.a.distanceTo(bar.b);
      for (const off of barOffsets(bar.order)) {
        _p.copy(_frame.mid).addScaledVector(_frame.perp, off);
        _s.set(w, w, dist);
        _m.compose(_p, _frame.quaternion, _s);
        this.bars.push(_m);
      }
    }
    for (const marker of this.previewMarkers) {
      bondFrame(marker.a, marker.b, _frame);
      _m.compose(_frame.mid, _frame.quaternion, ONE);
      this.markers.push(_m);
    }
    let badge = 0;
    for (const b of this.previewBadges) {
      const sprite = this.badge(badge++);
      sprite.material = b.charge > 0 ? this.plusMaterial : this.minusMaterial;
      sprite.position.set(b.x + 0.5, b.y + 0.5 + BADGE_OFFSET_Y, b.z + 0.5);
      sprite.visible = true;
    }
    for (let i = badge; i < this.badges.length; i++) (this.badges[i] as Sprite).visible = false;
    for (const pool of this.blockPools.values()) pool.end();
    this.bars.end();
    this.markers.end();
  }

  private badge(i: number): Sprite {
    let s = this.badges[i];
    if (!s) {
      s = new Sprite(this.plusMaterial);
      s.scale.set(BADGE_SCALE, BADGE_SCALE, 1);
      s.name = 'ghost-badge';
      this.parent.add(s);
      this.badges.push(s);
    }
    return s;
  }

  dispose(): void {
    for (const pool of this.blockPools.values()) pool.dispose();
    this.blockPools.clear();
    this.bars.dispose();
    this.markers.dispose();
    this.stickSpheres.dispose();
    this.stickBars.dispose();
    this.parent.remove(this.stickGroup);
    for (const s of this.badges) this.parent.remove(s);
    this.badges.length = 0;
    this.plusMaterial.dispose();
    this.minusMaterial.dispose();
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    this.previewBlocks = [];
    this.previewBars = [];
    this.previewMarkers = [];
    this.previewBadges = [];
    this.mirrorBlocks = [];
    this.cellInfo = new Map();
  }
}

function centerOf(p: Vec3): Vector3 {
  return new Vector3(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5);
}

export { WHITE as GHOST_BASE_COLOR };
