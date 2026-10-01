/**
 * Scene lighting: one hemisphere light and one directional "sun", no shadows.
 * DOM/WebGL package (imports three). docs/design/06-engine.md §11.3.
 * Every lit material in the game is a MeshLambertMaterial.
 */
import { DirectionalLight, HemisphereLight } from 'three';
import type { Object3D } from 'three';

export const HEMI_SKY = 0xdfe9ff;
export const HEMI_GROUND = 0x6b6b6b;
export const HEMI_INTENSITY = 1.0;
export const SUN_COLOR = 0xffffff;
export const SUN_INTENSITY = 1.2;
/** Direction the sun shines from (its position; the target stays at the origin). */
export const SUN_POSITION: readonly [number, number, number] = [0.5, 1, 0.3];

export interface Lights {
  readonly hemisphere: HemisphereLight;
  readonly sun: DirectionalLight;
  /** Removes both lights from their parent and releases them. */
  dispose(): void;
}

/** Creates the two lights and adds them to `parent` (normally the Scene). */
export function addLights(parent: Object3D): Lights {
  const hemisphere = new HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY);
  hemisphere.name = 'hemisphere';
  const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.name = 'sun';
  sun.position.set(SUN_POSITION[0], SUN_POSITION[1], SUN_POSITION[2]);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = false;
  parent.add(hemisphere);
  parent.add(sun);
  return {
    hemisphere,
    sun,
    dispose(): void {
      parent.remove(hemisphere);
      parent.remove(sun);
      hemisphere.dispose();
      sun.dispose();
    },
  };
}
