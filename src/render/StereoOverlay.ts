/**
 * Stereo overlay for the targeted molecule: R/S labels and halos, flat-centre
 * "?" markers with ghost H blocks, E/Z labels, alkene-geometry "!" markers and
 * ring-face discs with up/down arrows.
 * DOM/WebGL package (imports three). docs/design/06-engine.md §12.7.
 *
 * Shown only when the stereo-overlay setting is on and the target's analysis
 * carries `stereo`; rebuilt on 'molecule:analyzed' for the target and on
 * 'target:changed'. Sprites, halos and discs are pooled and reused.
 */
import {
  BoxGeometry, CircleGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Quaternion, Sprite, SpriteMaterial,
  TorusGeometry, Vector3,
} from 'three';
import type { Object3D } from 'three';
import type { Analysis, StereoAnalysis, Vec3 } from '../chem/types';
import { CPK_HEX, pairKey, parseCellKey } from '../world/types';
import type { CellKey, PairKey } from '../world/types';
import { H_BLOCK_SCALE } from './AtomRenderer';
import { makeElementTexture, makeGlyphTexture } from './element-texture';
import { InstancedPool } from './Renderer';

export const STEREO_COLOR = {
  R: 0x4a7bff, S: 0xff9f43, flat: 0xffd166, cannot: 0x9e9e9e, E: 0x2e7d32, Z: 0x6a1b9a, warn: 0xef5350,
  ringDisc: 0x4dd0e1, glyphDisc: 0x101418, halo: 0x101418,
} as const;
export const LABEL_OFFSET_Y = 0.9;
export const LABEL_SCALE = 0.5;
export const EZ_OFFSET_Y = 0.45;
export const EZ_SCALE = 0.45;
export const HALO_RADIUS = 0.55;
export const HALO_TUBE = 0.04;
/** Dark under-ring so the halo stays a two-tone ring (07 §2.3). */
export const HALO_DARK_TUBE = 0.065;
export const HALO_OPACITY = 0.8;
export const RING_DISC_RADIUS = 1.0;
export const RING_DISC_OPACITY = 0.18;
export const FACE_SPRITE_SCALE = 0.3;
export const FACE_OFFSET = 0.55;
export const GHOST_H_OPACITY = 0.35;

/** Structural subset of TargetState (07 §1.1): the analysis and the atom id -> cell map of the targeted component. */
export interface StereoTarget {
  readonly analysis: Analysis | null;
  readonly atomToCell: readonly CellKey[];
}

/** Pairs of C=C bonds whose label is COLLINEAR / NOT_PLANAR / TWISTED (tinted BOND_WARN by the BondRenderer). */
export function warnPairsOf(stereo: StereoAnalysis | null | undefined, atomToCell: readonly CellKey[]): Set<PairKey> {
  const out = new Set<PairKey>();
  if (!stereo) return out;
  for (const db of stereo.doubleBonds) {
    if (db.label !== 'COLLINEAR' && db.label !== 'NOT_PLANAR' && db.label !== 'TWISTED') continue;
    const a = atomToCell[db.a];
    const b = atomToCell[db.b];
    if (a && b) out.add(pairKey(a, b));
  }
  return out;
}

const PLUS_Z = new Vector3(0, 0, 1);
const _m = new Matrix4();
const _q = new Quaternion();
const _n = new Vector3();

export class StereoOverlay {
  private readonly parent: Object3D;
  private readonly spriteMaterials = new Map<string, SpriteMaterial>();
  private readonly sprites: Sprite[] = [];
  private readonly haloGeometry: TorusGeometry;
  private readonly haloDarkGeometry: TorusGeometry;
  private readonly haloMaterials = new Map<number, MeshBasicMaterial>();
  private readonly haloDarkMaterial: MeshBasicMaterial;
  private readonly halos: { ring: Mesh; dark: Mesh }[] = [];
  private readonly discGeometries = new Map<number, CircleGeometry>();
  private readonly discMaterial: MeshBasicMaterial;
  private readonly discs: Mesh[] = [];
  private readonly ghostHGeometry: BoxGeometry;
  private readonly ghostHMaterial: MeshLambertMaterial;
  private readonly ghostH: InstancedPool;
  private enabledFlag = true;
  private target: StereoTarget | null = null;
  /** Counts after the last update (diagnostics). */
  spriteCount = 0;

  constructor(parent: Object3D) {
    this.parent = parent;
    this.haloGeometry = new TorusGeometry(HALO_RADIUS, HALO_TUBE, 8, 24);
    this.haloDarkGeometry = new TorusGeometry(HALO_RADIUS, HALO_DARK_TUBE, 8, 24);
    this.haloDarkMaterial = new MeshBasicMaterial({ color: STEREO_COLOR.halo, transparent: true, opacity: HALO_OPACITY, depthWrite: false });
    this.discMaterial = new MeshBasicMaterial({ color: STEREO_COLOR.ringDisc, transparent: true, opacity: RING_DISC_OPACITY, side: DoubleSide, depthWrite: false });
    this.ghostHGeometry = new BoxGeometry(H_BLOCK_SCALE, H_BLOCK_SCALE, H_BLOCK_SCALE);
    this.ghostHMaterial = new MeshLambertMaterial({ map: makeElementTexture('?', CPK_HEX.H, 'black'), transparent: true, opacity: GHOST_H_OPACITY, depthWrite: false });
    this.ghostHMaterial.name = 'stereo-ghost-h';
    this.ghostH = new InstancedPool(parent, this.ghostHGeometry, this.ghostHMaterial, 16, { name: 'stereo-ghost-h' });
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  /** 07 §1.3 setStereoOverlay / Settings.stereoOverlay. Re-applies the last target. */
  setEnabled(on: boolean): void {
    this.enabledFlag = on;
    this.update(this.target);
  }

  /** Rebuilds the overlay for `target` (null hides everything). Idempotent. */
  update(target: StereoTarget | null): void {
    this.target = target;
    const stereo = target?.analysis?.stereo ?? null;
    const cells = target?.atomToCell ?? [];
    let sprites = 0;
    let halos = 0;
    let discs = 0;
    this.ghostH.begin();
    if (this.enabledFlag && stereo) {
      const centre = (atom: number): Vec3 | null => {
        const cell = cells[atom];
        if (!cell) return null;
        const [x, y, z] = parseCellKey(cell);
        return [x + 0.5, y + 0.5, z + 0.5];
      };

      for (const c of stereo.centers) {
        const p = centre(c.atom);
        if (!p) continue;
        switch (c.label) {
          case 'R':
          case 'S': {
            const colour = c.label === 'R' ? STEREO_COLOR.R : STEREO_COLOR.S;
            this.sprite(sprites++, this.labelMaterial(c.label, colour, 0xffffff), p[0], p[1] + LABEL_OFFSET_Y, p[2], LABEL_SCALE);
            this.halo(halos++, colour, p);
            break;
          }
          case 'UNSPECIFIED': {
            this.sprite(sprites++, this.labelMaterial('?', STEREO_COLOR.flat, 0x000000), p[0], p[1] + LABEL_OFFSET_Y, p[2], LABEL_SCALE);
            this.halo(halos++, STEREO_COLOR.flat, p);
            if (c.shape === 'T' && c.suggestedHPositions) {
              for (const h of c.suggestedHPositions) {
                _m.makeTranslation(h[0] + 0.5, h[1] + 0.5, h[2] + 0.5);
                this.ghostH.push(_m);
              }
            }
            break;
          }
          case 'CANNOT_ASSIGN':
            this.halo(halos++, STEREO_COLOR.cannot, p);
            break;
          default:
            break;
        }
      }

      for (const db of stereo.doubleBonds) {
        const pa = centre(db.a);
        const pb = centre(db.b);
        if (!pa || !pb) continue;
        const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
        switch (db.label) {
          case 'E':
          case 'Z': {
            const colour = db.label === 'E' ? STEREO_COLOR.E : STEREO_COLOR.Z;
            this.sprite(sprites++, this.labelMaterial(db.label, colour, 0xffffff), mid[0], mid[1] + EZ_OFFSET_Y, mid[2], EZ_SCALE);
            break;
          }
          case 'COLLINEAR':
          case 'NOT_PLANAR':
          case 'TWISTED':
            this.sprite(sprites++, this.labelMaterial('!', STEREO_COLOR.warn, 0xffffff), mid[0], mid[1] + EZ_OFFSET_Y, mid[2], EZ_SCALE);
            break;
          default:
            break;
        }
      }

      for (const rf of stereo.ringFaces) {
        if (!rf.subs.some((s) => s.face !== 0)) continue;
        const pts = rf.ring.map(centre).filter((p): p is Vec3 => p !== null);
        if (pts.length === 0) continue;
        const centroid: [number, number, number] = [0, 0, 0];
        for (const p of pts) {
          centroid[0] += p[0] / pts.length;
          centroid[1] += p[1] / pts.length;
          centroid[2] += p[2] / pts.length;
        }
        this.disc(discs++, rf.ring.length, centroid, rf.normal);
        for (const s of rf.subs) {
          if (s.face === 0) continue;
          const p = centre(s.atom);
          if (!p) continue;
          const glyph = s.face === 1 ? '▲' : '▼';
          this.sprite(
            sprites++,
            this.labelMaterial(glyph, STEREO_COLOR.glyphDisc, 0xffffff),
            p[0] + FACE_OFFSET * rf.normal[0] * s.face,
            p[1] + FACE_OFFSET * rf.normal[1] * s.face,
            p[2] + FACE_OFFSET * rf.normal[2] * s.face,
            FACE_SPRITE_SCALE,
          );
        }
      }
    }
    this.ghostH.end();
    for (let i = sprites; i < this.sprites.length; i++) (this.sprites[i] as Sprite).visible = false;
    for (let i = halos; i < this.halos.length; i++) {
      const h = this.halos[i] as { ring: Mesh; dark: Mesh };
      h.ring.visible = false;
      h.dark.visible = false;
    }
    for (let i = discs; i < this.discs.length; i++) (this.discs[i] as Mesh).visible = false;
    this.spriteCount = sprites;
  }

  private labelMaterial(text: string, bgHex: number, fgHex: number): SpriteMaterial {
    const key = `${text}|${bgHex}|${fgHex}`;
    let m = this.spriteMaterials.get(key);
    if (!m) {
      m = new SpriteMaterial({ map: makeGlyphTexture(text, bgHex, fgHex), transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true });
      this.spriteMaterials.set(key, m);
    }
    return m;
  }

  private sprite(i: number, material: SpriteMaterial, x: number, y: number, z: number, scale: number): Sprite {
    let s = this.sprites[i];
    if (!s) {
      s = new Sprite(material);
      s.name = 'stereo-label';
      this.parent.add(s);
      this.sprites.push(s);
    }
    s.material = material;
    s.position.set(x, y, z);
    s.scale.set(scale, scale, 1);
    s.visible = true;
    return s;
  }

  private haloMaterial(hex: number): MeshBasicMaterial {
    let m = this.haloMaterials.get(hex);
    if (!m) {
      m = new MeshBasicMaterial({ color: hex, transparent: true, opacity: HALO_OPACITY, depthWrite: false });
      this.haloMaterials.set(hex, m);
    }
    return m;
  }

  /** Torus in the xz plane (rotated x = pi/2) around the atom centre, over a dark under-ring. */
  private halo(i: number, hex: number, p: Vec3): void {
    let h = this.halos[i];
    if (!h) {
      const ring = new Mesh(this.haloGeometry, this.haloMaterial(hex));
      const dark = new Mesh(this.haloDarkGeometry, this.haloDarkMaterial);
      ring.rotation.x = Math.PI / 2;
      dark.rotation.x = Math.PI / 2;
      dark.renderOrder = -1;
      ring.name = 'stereo-halo';
      dark.name = 'stereo-halo-dark';
      this.parent.add(dark);
      this.parent.add(ring);
      h = { ring, dark };
      this.halos.push(h);
    }
    h.ring.material = this.haloMaterial(hex);
    h.ring.position.set(p[0], p[1], p[2]);
    h.dark.position.set(p[0], p[1], p[2]);
    h.ring.visible = true;
    h.dark.visible = true;
  }

  private disc(i: number, segments: number, centroid: Vec3, normal: Vec3): void {
    const seg = Math.max(3, segments | 0);
    let g = this.discGeometries.get(seg);
    if (!g) {
      g = new CircleGeometry(RING_DISC_RADIUS, seg);
      this.discGeometries.set(seg, g);
    }
    let d = this.discs[i];
    if (!d) {
      d = new Mesh(g, this.discMaterial);
      d.name = 'ring-face';
      this.parent.add(d);
      this.discs.push(d);
    }
    d.geometry = g;
    d.position.set(centroid[0], centroid[1], centroid[2]);
    _n.set(normal[0], normal[1], normal[2]);
    if (_n.lengthSq() === 0) _n.set(0, 1, 0);
    _n.normalize();
    _q.setFromUnitVectors(PLUS_Z, _n);
    d.quaternion.copy(_q);
    d.visible = true;
  }

  dispose(): void {
    for (const s of this.sprites) this.parent.remove(s);
    this.sprites.length = 0;
    for (const m of this.spriteMaterials.values()) m.dispose();
    this.spriteMaterials.clear();
    for (const h of this.halos) {
      this.parent.remove(h.ring);
      this.parent.remove(h.dark);
    }
    this.halos.length = 0;
    for (const m of this.haloMaterials.values()) m.dispose();
    this.haloMaterials.clear();
    this.haloDarkMaterial.dispose();
    this.haloGeometry.dispose();
    this.haloDarkGeometry.dispose();
    for (const d of this.discs) this.parent.remove(d);
    this.discs.length = 0;
    for (const g of this.discGeometries.values()) g.dispose();
    this.discGeometries.clear();
    this.discMaterial.dispose();
    this.ghostH.dispose();
    this.ghostHGeometry.dispose();
    this.ghostHMaterial.dispose();
    this.target = null;
  }
}
