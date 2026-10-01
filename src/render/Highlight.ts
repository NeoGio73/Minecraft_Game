/**
 * Highlights drawn over the world: the hovered block / atom outline, the bond
 * hover box and break-marker frame, atom shells (target, group, hover,
 * selected, result), the quiz marked atom, select-mode outlines, refusal
 * flashes and submission pulses.
 * DOM/WebGL package (imports three). docs/design/06-engine.md §12.6;
 * 09-amendment-no-bond.md §5.4; 07-ui.md §1.3 (hooks), §2.3 (two-tone rings),
 * §2.4 (reduced motion: no pulsing, flashes become holds).
 *
 * Every outline is two-tone (colour line over a slightly larger dark line) so
 * it stays >= 3:1 against the sky, sand and every atom colour. Nothing here
 * flashes above 3 Hz.
 */
import {
  BackSide, BoxGeometry, Color, EdgesGeometry, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, Quaternion,
  Sprite, SpriteMaterial, Vector3,
} from 'three';
import type { Object3D } from 'three';
import type { Vec3 } from '../chem/types';
import { cellIndex, parseCellKey } from '../world/types';
import type { CellKey, IndexedAtom, MoleculeIndex, PairKey } from '../world/types';
import { implicitHCell } from '../world/extract';
import { EXPLICIT_H_SCALE, explicitHydrogenCount } from './AtomRenderer';
import type { GetBlock } from './AtomRenderer';
import { BREAK_SIZE, BREAK_THICK, bondFrame, pairCenters } from './BondRenderer';
import type { BondFrame } from './BondRenderer';
import { makeGlyphTexture } from './element-texture';
import { InstancedPool } from './Renderer';

export const SHELL = {
  hover: 0xffd54f, target: 0xf4f6f8, selected: 0x4dd0e1, correct: 0x66bb6a, wrong: 0xef5350,
  /** Functional-group highlight (07 §1.3 setGroupHighlight). */
  group: 0xba68c8,
  /** Quiz marked atom (07 --marked). */
  marked: 0xff9800,
} as const;
export const SHELL_SIZE = { target: 0.70, hover: 0.74, selected: 0.74, result: 0.76, group: 0.72 } as const;
export const FLASH_MS = 300;
/** Correct set: RESULT_PULSES pulses, each FLASH_MS in and FLASH_MS out (1.2 s total). */
export const RESULT_PULSES = 2;
/** A wrong pick holds SHELL.wrong this long. */
export const WRONG_HOLD_MS = 1200;
export const SHELL_OPACITY = 0.85;
export const SHELL_CAPACITY = 2048;
export const OUTLINE_SIZE = 1.002;
export const OUTLINE_DARK_SIZE = 1.008;
export const OUTLINE_DARK = 0x101418;
export const OUTLINE_WHITE = 0xffffff;
export const BOND_BOX: Vec3 = [0.2, 0.2, 1.0];
export const BOND_BOX_OPACITY = 0.6;
/** Shell around an implicit-H mini-block (0.4) and around an explicit H block (0.55). */
export const H_SHELL = 0.5;
export const EXPLICIT_H_SHELL = EXPLICIT_H_SCALE + 0.08;
export const MARKED_OFFSET_Y = 0.9;
export const MARKED_SCALE = 0.45;
export const SELECTED_SPRITE_SCALE = 0.3;
/** Pulse rate of hovered / marked outlines (scale ± PULSE_AMPLITUDE); static under reduced motion. */
export const PULSE_HZ = 1;
export const PULSE_AMPLITUDE = 0.04;

/** Structural subset of Game's HoverInfo (06 §1) that the highlight needs; HoverInfo is assignable to it. */
export type HighlightHover =
  | { readonly kind: 'none' }
  | { readonly kind: 'bench' }
  | { readonly kind: 'block'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'atom'; readonly cell: CellKey }
  | { readonly kind: 'hydrogen'; readonly cell: CellKey; readonly slot: number; readonly explicit: boolean }
  | { readonly kind: 'bond'; readonly pair: PairKey; readonly order: number };

export interface HydrogenSelection {
  readonly cell: CellKey;
  readonly slot: number;
}

export interface HighlightView {
  readonly hover: HighlightHover;
  /** Every atom cell of State.target's component. */
  readonly targetCells: readonly CellKey[];
  /** Cells of State.selection items (resolved by Game through locked[i].atomToCell / target.atomToCell). */
  readonly selectedCells: readonly CellKey[];
  /** Selection items with an hSlot: the parent cell and the slot (explicit blocks first). */
  readonly selectedHydrogens: readonly HydrogenSelection[];
  readonly reducedMotion: boolean;
}

/** 07 §1.3 HCell: a box centre and half-extent in world units. */
export interface HCellLike {
  readonly center: Vec3;
  readonly half: number;
}

export interface SelectHighlights {
  readonly hovered: HCellLike | null;
  readonly selected: readonly HCellLike[];
  readonly correct: readonly HCellLike[];
  readonly wrong: readonly HCellLike[];
}

interface ShellEntry {
  readonly colour: Color;
  readonly size: number;
}

interface OutlineBox {
  readonly colour: LineSegments;
  readonly dark: LineSegments;
}

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _frame: BondFrame = { mid: new Vector3(), axis: new Vector3(), perp: new Vector3(), quaternion: new Quaternion() };
const _a = new Vector3();
const _b = new Vector3();
const _c = new Color();

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 0..1 triangle pulse over `periodMs` (0 at the start and end, 1 in the middle). */
function triangle(elapsedMs: number, periodMs: number): number {
  const t = ((elapsedMs % periodMs) + periodMs) % periodMs / periodMs;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

export class Highlight {
  private readonly parent: Object3D;
  private readonly outline: OutlineBox;
  private readonly outlineMaterial: LineBasicMaterial;
  private readonly outlineDarkMaterial: LineBasicMaterial;
  private readonly unitEdges: EdgesGeometry;
  private readonly bondBoxMaterial: MeshBasicMaterial;
  private readonly bondBox: Mesh;
  private readonly breakFrame: Mesh;
  private readonly shellGeometry: BoxGeometry;
  private readonly shellMaterial: MeshBasicMaterial;
  private readonly shells: InstancedPool;
  private readonly lineMaterials = new Map<number, LineBasicMaterial>();
  private readonly outlinePool: OutlineBox[] = [];
  private readonly spritePool: Sprite[] = [];
  private readonly markedSpriteMaterial: SpriteMaterial;
  private readonly selectedSpriteMaterial: SpriteMaterial;

  private index: MoleculeIndex | null = null;
  private getBlock: GetBlock | null = null;
  private view: HighlightView | null = null;
  private groupCells: ReadonlySet<CellKey> | null = null;
  private marked: CellKey | null = null;
  private select: SelectHighlights | null = null;
  private selectSince = 0;
  private results: { correct: readonly CellKey[]; wrong: readonly CellKey[]; since: number } | null = null;
  private flash: { target: 'outline' | 'bond'; since: number } | null = null;
  private reducedMotion = false;
  private resultsSettled = false;
  private readonly colours = new Map<number, Color>();

  constructor(parent: Object3D) {
    this.parent = parent;
    this.unitEdges = new EdgesGeometry(new BoxGeometry(1, 1, 1));
    this.outlineMaterial = new LineBasicMaterial({ color: OUTLINE_WHITE });
    this.outlineDarkMaterial = new LineBasicMaterial({ color: OUTLINE_DARK });
    this.outline = this.makeOutline(this.outlineMaterial, this.outlineDarkMaterial);
    this.outline.colour.scale.setScalar(OUTLINE_SIZE);
    this.outline.dark.scale.setScalar(OUTLINE_DARK_SIZE);
    this.outline.colour.name = 'outline';
    this.outline.dark.name = 'outline-dark';
    this.bondBoxMaterial = new MeshBasicMaterial({ color: SHELL.hover, transparent: true, opacity: BOND_BOX_OPACITY, depthWrite: false });
    this.bondBox = new Mesh(new BoxGeometry(BOND_BOX[0], BOND_BOX[1], BOND_BOX[2]), this.bondBoxMaterial);
    this.bondBox.name = 'bond-hover';
    this.bondBox.visible = false;
    parent.add(this.bondBox);
    this.breakFrame = new Mesh(new BoxGeometry(BREAK_SIZE + 0.14, BREAK_SIZE + 0.14, BREAK_THICK + 0.12), this.bondBoxMaterial);
    this.breakFrame.name = 'break-hover';
    this.breakFrame.visible = false;
    parent.add(this.breakFrame);
    this.shellGeometry = new BoxGeometry(1, 1, 1);
    this.shellMaterial = new MeshBasicMaterial({ side: BackSide, transparent: true, opacity: SHELL_OPACITY, depthWrite: false });
    this.shellMaterial.name = 'shells';
    this.shells = new InstancedPool(parent, this.shellGeometry, this.shellMaterial, SHELL_CAPACITY, { useColor: true, name: 'shells' });
    this.markedSpriteMaterial = new SpriteMaterial({ map: makeGlyphTexture('?', SHELL.marked, 0x000000), depthWrite: false, transparent: true });
    this.selectedSpriteMaterial = new SpriteMaterial({ map: makeGlyphTexture('✓', SHELL.selected, 0x000000), depthWrite: false, transparent: true });
  }

  private makeOutline(colour: LineBasicMaterial, dark: LineBasicMaterial): OutlineBox {
    const c = new LineSegments(this.unitEdges, colour);
    const d = new LineSegments(this.unitEdges, dark);
    d.renderOrder = -1;
    c.visible = false;
    d.visible = false;
    this.parent.add(d);
    this.parent.add(c);
    return { colour: c, dark: d };
  }

  /** Cached, never-mutated Color per sRGB hex (InstancedMesh.setColorAt copies it). */
  private colour(hex: number): Color {
    let c = this.colours.get(hex);
    if (!c) {
      c = new Color(hex);
      this.colours.set(hex, c);
    }
    return c;
  }

  private lineMaterial(hex: number): LineBasicMaterial {
    let m = this.lineMaterials.get(hex);
    if (!m) {
      m = new LineBasicMaterial({ color: hex });
      this.lineMaterials.set(hex, m);
    }
    return m;
  }

  // ---------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------

  /** Replaces the hover / target / selection view and redraws (idempotent). */
  update(index: MoleculeIndex, getBlock: GetBlock, view: HighlightView): void {
    this.index = index;
    this.getBlock = getBlock;
    this.view = view;
    this.reducedMotion = view.reducedMotion;
    this.redraw(nowMs());
  }

  /** 07 §1.3 setReducedMotion. `update()` also reads view.reducedMotion. */
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.redraw(nowMs());
  }

  /** 07 §1.3 setGroupHighlight: tints the atoms of one functional group (null clears). */
  setGroupHighlight(cells: readonly CellKey[] | null): void {
    this.groupCells = cells && cells.length > 0 ? new Set(cells) : null;
    this.redraw(nowMs());
  }

  /** 07 §1.3 setMarkedAtom: orange two-tone outline plus a "?" sprite (static under reduced motion). */
  setMarkedAtom(cell: CellKey | null): void {
    this.marked = cell;
    this.redraw(nowMs());
  }

  /** 07 §1.3 setSelectHighlights: outlines around select-mode candidates (each list replaces the previous). */
  setSelectHighlights(h: SelectHighlights | null): void {
    this.select = h;
    this.selectSince = nowMs();
    this.redraw(this.selectSince);
  }

  /**
   * Refused placement / wand action: the block outline (or, when a bond or
   * break marker is hovered, the bond box / frame) turns SHELL.wrong and fades
   * back over FLASH_MS; with reduced motion the colour is held then reset.
   */
  flashRefusal(): void {
    const target = this.view?.hover.kind === 'bond' ? 'bond' : 'outline';
    this.flash = { target, since: nowMs() };
    this.applyFlash(this.flash.since);
  }

  /**
   * Submission result (from 'challenge:submitted'): the correct cells pulse
   * SHELL.correct RESULT_PULSES times then stay green until clearResult(); the
   * wrong cells hold SHELL.wrong for WRONG_HOLD_MS.
   */
  showResult(correct: readonly CellKey[], wrong: readonly CellKey[]): void {
    this.results = correct.length > 0 || wrong.length > 0 ? { correct, wrong, since: nowMs() } : null;
    this.resultsSettled = false;
    this.redraw(nowMs());
  }

  clearResult(): void {
    if (!this.results) return;
    this.results = null;
    this.redraw(nowMs());
  }

  /** Diagnostics (DebugApi.hoverOutline): whether the hover outline is drawn and the cell it marks. */
  outlineInfo(): { visible: boolean; x: number; y: number; z: number } {
    const p = this.outline.colour.position;
    return { visible: this.outline.colour.visible, x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  }

  // ---------------------------------------------------------------------
  // Per-frame animation
  // ---------------------------------------------------------------------

  /** Call every frame: drives the flash fade, result pulses and the hover / marked pulses. */
  tick(now: number = nowMs()): void {
    let needsRedraw = false;
    if (this.flash) {
      this.applyFlash(now);
    }
    if (this.results && !this.resultsSettled) {
      const elapsed = now - this.results.since;
      const done = elapsed >= Math.max(RESULT_PULSES * 2 * FLASH_MS, WRONG_HOLD_MS);
      needsRedraw = true;
      if (done) this.resultsSettled = true; // one last redraw with the settled colours
    }
    if (!this.reducedMotion && (this.marked !== null || this.select?.hovered || (this.select && this.select.correct.length > 0))) {
      needsRedraw = true;
    }
    if (needsRedraw) this.redraw(now);
  }

  private applyFlash(now: number): void {
    if (!this.flash) return;
    const t = (now - this.flash.since) / FLASH_MS;
    const base = this.flash.target === 'bond' ? SHELL.hover : OUTLINE_WHITE;
    const material = this.flash.target === 'bond' ? this.bondBoxMaterial : this.outlineMaterial;
    if (t >= 1) {
      material.color.setHex(base);
      this.flash = null;
      return;
    }
    if (this.reducedMotion) {
      material.color.setHex(SHELL.wrong);
    } else {
      material.color.setHex(SHELL.wrong).lerp(_c.setHex(base), Math.max(0, Math.min(1, t)));
    }
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------

  private redraw(now: number): void {
    this.drawHover();
    this.drawShells(now);
    this.drawOutlines(now);
  }

  private hydrogenShellCenter(cell: CellKey, slot: number, explicit: boolean, out: Vector3): number | null {
    const index = this.index;
    const getBlock = this.getBlock;
    if (!index || !getBlock) return null;
    const atom = index.atoms.get(cell);
    if (!atom) return null;
    if (explicit) {
      if (atom.el === 'H') {
        out.set(atom.x + 0.5, atom.y + 0.5, atom.z + 0.5);
        return EXPLICIT_H_SHELL;
      }
      const hs = index.neighbours(cell).filter((a) => a.el === 'H').sort((p, q) => cellIndex(p.x, p.y, p.z) - cellIndex(q.x, q.y, q.z));
      const h: IndexedAtom | undefined = hs[slot];
      if (!h) return null;
      out.set(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      return EXPLICIT_H_SHELL;
    }
    const k = slot - explicitHydrogenCount(index, cell);
    const c = implicitHCell(getBlock, atom.x, atom.y, atom.z, k);
    if (!c) return null;
    out.set(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5);
    return H_SHELL;
  }

  private drawHover(): void {
    const hover = this.view?.hover ?? { kind: 'none' as const };
    let outlineAt: Vec3 | null = null;
    this.bondBox.visible = false;
    this.breakFrame.visible = false;
    switch (hover.kind) {
      case 'block':
        outlineAt = [hover.x, hover.y, hover.z];
        break;
      case 'atom': {
        const [x, y, z] = parseCellKey(hover.cell);
        outlineAt = [x, y, z];
        break;
      }
      case 'bond': {
        pairCenters(hover.pair, _a, _b);
        bondFrame(_a, _b, _frame);
        const target = hover.order === 0 ? this.breakFrame : this.bondBox;
        target.position.copy(_frame.mid);
        target.quaternion.copy(_frame.quaternion);
        target.visible = true;
        break;
      }
      default:
        break;
    }
    if (outlineAt) {
      this.outline.colour.position.set(outlineAt[0] + 0.5, outlineAt[1] + 0.5, outlineAt[2] + 0.5);
      this.outline.dark.position.copy(this.outline.colour.position);
      this.outline.colour.visible = true;
      this.outline.dark.visible = true;
    } else {
      this.outline.colour.visible = false;
      this.outline.dark.visible = false;
    }
    if (!this.flash) this.outlineMaterial.color.setHex(OUTLINE_WHITE);
  }

  private drawShells(now: number): void {
    const view = this.view;
    const entries = new Map<CellKey, ShellEntry>();
    const put = (cell: CellKey, hex: number, size: number): void => {
      entries.set(cell, { colour: this.colour(hex), size });
    };
    if (view) {
      for (const c of view.targetCells) put(c, SHELL.target, SHELL_SIZE.target);
    }
    if (this.groupCells) {
      for (const c of this.groupCells) put(c, SHELL.group, SHELL_SIZE.group);
    }
    if (view && view.hover.kind === 'atom') put(view.hover.cell, SHELL.hover, SHELL_SIZE.hover);
    if (view) {
      for (const c of view.selectedCells) put(c, SHELL.selected, SHELL_SIZE.selected);
    }
    if (this.results) {
      const elapsed = now - this.results.since;
      const pulseWindow = RESULT_PULSES * 2 * FLASH_MS;
      let green: Color;
      if (this.reducedMotion || elapsed >= pulseWindow) green = this.colour(SHELL.correct);
      else green = new Color(SHELL.target).lerp(_c.setHex(SHELL.correct), triangle(elapsed, 2 * FLASH_MS));
      for (const c of this.results.correct) entries.set(c, { colour: green, size: SHELL_SIZE.result });
      if (elapsed < WRONG_HOLD_MS) {
        for (const c of this.results.wrong) put(c, SHELL.wrong, SHELL_SIZE.result);
      }
    }

    this.shells.begin();
    for (const [cell, e] of entries) {
      const [x, y, z] = parseCellKey(cell);
      _p.set(x + 0.5, y + 0.5, z + 0.5);
      _s.setScalar(e.size);
      _m.compose(_p, _q.identity(), _s);
      this.shells.push(_m, e.colour);
    }
    // hydrogen shells (hover and selection)
    if (view) {
      if (view.hover.kind === 'hydrogen') {
        const size = this.hydrogenShellCenter(view.hover.cell, view.hover.slot, view.hover.explicit, _p);
        if (size !== null) {
          _s.setScalar(size);
          _m.compose(_p, _q.identity(), _s);
          this.shells.push(_m, _c.setHex(SHELL.hover));
        }
      }
      for (const h of view.selectedHydrogens) {
        const explicitCount = this.index ? explicitHydrogenCount(this.index, h.cell) : 0;
        const size = this.hydrogenShellCenter(h.cell, h.slot, h.slot < explicitCount, _p);
        if (size !== null) {
          _s.setScalar(size);
          _m.compose(_p, _q.identity(), _s);
          this.shells.push(_m, _c.setHex(SHELL.selected));
        }
      }
    }
    this.shells.end();
  }

  private outlineAt(i: number, hex: number): OutlineBox {
    let box = this.outlinePool[i];
    if (!box) {
      box = this.makeOutline(this.lineMaterial(hex), this.outlineDarkMaterial);
      box.colour.name = 'select-outline';
      box.dark.name = 'select-outline-dark';
      this.outlinePool.push(box);
    }
    box.colour.material = this.lineMaterial(hex);
    box.colour.visible = true;
    box.dark.visible = true;
    return box;
  }

  private spriteAt(i: number, material: SpriteMaterial, x: number, y: number, z: number, scale: number): Sprite {
    let s = this.spritePool[i];
    if (!s) {
      s = new Sprite(material);
      s.name = 'highlight-sprite';
      this.parent.add(s);
      this.spritePool.push(s);
    }
    s.material = material;
    s.position.set(x, y, z);
    s.scale.set(scale, scale, 1);
    s.visible = true;
    return s;
  }

  private placeBox(box: OutlineBox, center: Vec3, size: number, pulse: number): void {
    const k = 1 + PULSE_AMPLITUDE * pulse;
    box.colour.position.set(center[0], center[1], center[2]);
    box.dark.position.set(center[0], center[1], center[2]);
    box.colour.scale.setScalar((size + 0.04) * k);
    box.dark.scale.setScalar((size + 0.07) * k);
  }

  private drawOutlines(now: number): void {
    let boxes = 0;
    let sprites = 0;
    const animate = !this.reducedMotion;
    const pulse = animate ? triangle(now, 1000 / PULSE_HZ) : 0;

    if (this.marked) {
      const [x, y, z] = parseCellKey(this.marked);
      this.placeBox(this.outlineAt(boxes++, SHELL.marked), [x + 0.5, y + 0.5, z + 0.5], 1.0, pulse);
      this.spriteAt(sprites++, this.markedSpriteMaterial, x + 0.5, y + 0.5 + MARKED_OFFSET_Y, z + 0.5, MARKED_SCALE);
    }
    const sel = this.select;
    if (sel) {
      const elapsed = now - this.selectSince;
      if (sel.hovered) this.placeBox(this.outlineAt(boxes++, SHELL.hover), sel.hovered.center, sel.hovered.half * 2, pulse);
      for (const h of sel.selected) {
        this.placeBox(this.outlineAt(boxes++, SHELL.selected), h.center, h.half * 2, 0);
        this.spriteAt(sprites++, this.selectedSpriteMaterial, h.center[0], h.center[1] + h.half + 0.3, h.center[2], SELECTED_SPRITE_SCALE);
      }
      const correctPulse = animate && elapsed < RESULT_PULSES * 2 * FLASH_MS ? triangle(elapsed, 2 * FLASH_MS) : 0;
      for (const h of sel.correct) this.placeBox(this.outlineAt(boxes++, SHELL.correct), h.center, h.half * 2, correctPulse);
      for (const h of sel.wrong) this.placeBox(this.outlineAt(boxes++, SHELL.wrong), h.center, h.half * 2, 0);
    }
    for (let i = boxes; i < this.outlinePool.length; i++) {
      const box = this.outlinePool[i] as OutlineBox;
      box.colour.visible = false;
      box.dark.visible = false;
    }
    for (let i = sprites; i < this.spritePool.length; i++) (this.spritePool[i] as Sprite).visible = false;
  }

  dispose(): void {
    this.parent.remove(this.outline.colour);
    this.parent.remove(this.outline.dark);
    for (const box of this.outlinePool) {
      this.parent.remove(box.colour);
      this.parent.remove(box.dark);
    }
    this.outlinePool.length = 0;
    for (const s of this.spritePool) this.parent.remove(s);
    this.spritePool.length = 0;
    this.parent.remove(this.bondBox);
    this.parent.remove(this.breakFrame);
    this.bondBox.geometry.dispose();
    this.breakFrame.geometry.dispose();
    this.bondBoxMaterial.dispose();
    this.shells.dispose();
    this.shellGeometry.dispose();
    this.shellMaterial.dispose();
    this.unitEdges.dispose();
    this.outlineMaterial.dispose();
    this.outlineDarkMaterial.dispose();
    for (const m of this.lineMaterials.values()) m.dispose();
    this.lineMaterials.clear();
    this.markedSpriteMaterial.dispose();
    this.selectedSpriteMaterial.dispose();
    this.index = null;
    this.getBlock = null;
    this.view = null;
  }
}
