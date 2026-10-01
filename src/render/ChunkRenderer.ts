/**
 * One Mesh per chunk, rebuilt from the pure mesher when the chunk is dirty.
 * DOM/WebGL package (imports three). docs/design/06-engine.md §12.1.
 *
 * The mesher emits world-space vertices (through ox/oz), so every chunk mesh
 * sits at the scene origin with `matrixAutoUpdate = false`; the geometry's
 * bounding sphere is the frustum-cull volume directly.
 */
import { BufferAttribute, BufferGeometry, Mesh, MeshLambertMaterial } from 'three';
import type { Object3D } from 'three';
import { CHUNK_D, CHUNK_W } from '../world/types';
import type { MeshBuffers } from '../world/types';
import type { Chunk } from '../world/chunk';
import { chunkIndex } from '../world/chunk';
import { buildChunkMesh, createMeshBuffers } from '../world/mesher';
import type { World } from '../world/world';
import { PALETTE_LINEAR } from './palette';

export class ChunkRenderer {
  private readonly parent: Object3D;
  private readonly world: World;
  private readonly meshes: (Mesh | null)[];
  /** Chunk version each mesh was built from (diagnostics; `dirty` is the rebuild trigger). */
  private readonly builtVersion: number[];
  private readonly buffers: MeshBuffers = createMeshBuffers();
  readonly material: MeshLambertMaterial;
  /** Total faces currently uploaded (diagnostics). */
  faces = 0;

  constructor(parent: Object3D, world: World) {
    this.parent = parent;
    this.world = world;
    this.meshes = world.chunks.map(() => null);
    this.builtVersion = world.chunks.map(() => -1);
    this.material = new MeshLambertMaterial({ vertexColors: true });
    this.material.name = 'chunk';
  }

  /**
   * Rebuilds up to `maxPerFrame` dirty chunks, nearest to (p.x, p.z) first.
   * Returns the number rebuilt.
   */
  rebuildDirty(world: World, p: { readonly x: number; readonly z: number }, maxPerFrame: number): number {
    const dirty = world.dirtyChunks(p.x, p.z);
    const n = Math.min(dirty.length, Math.max(0, maxPerFrame | 0));
    for (let i = 0; i < n; i++) {
      const chunk = dirty[i] as Chunk;
      const faces = buildChunkMesh(world.getBlock, chunk.cx * CHUNK_W, chunk.cz * CHUNK_D, PALETTE_LINEAR, this.buffers);
      this.applyChunkMesh(chunk, this.buffers, faces);
    }
    return n;
  }

  /** Uploads `faces` faces of `buffers` as the chunk's geometry; removes the mesh when the chunk is empty. */
  applyChunkMesh(chunk: Chunk, buffers: MeshBuffers, faces: number): void {
    const ci = chunkIndex(chunk.cx, chunk.cz);
    const prev = this.meshes[ci] ?? null;
    const prevFaces = prev ? (prev.geometry.index?.count ?? 0) / 6 : 0;
    if (prev) prev.geometry.dispose();
    if (faces === 0) {
      if (prev) {
        this.parent.remove(prev);
        this.meshes[ci] = null;
      }
    } else {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(buffers.pos.slice(0, faces * 12), 3));
      g.setAttribute('normal', new BufferAttribute(buffers.nor.slice(0, faces * 12), 3));
      g.setAttribute('color', new BufferAttribute(buffers.col.slice(0, faces * 12), 3));
      g.setIndex(new BufferAttribute(buffers.idx.slice(0, faces * 6), 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      if (prev) {
        prev.geometry = g;
      } else {
        const mesh = new Mesh(g, this.material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.identity();
        mesh.matrixWorld.identity();
        mesh.frustumCulled = true;
        mesh.name = `chunk-${chunk.cx}-${chunk.cz}`;
        this.parent.add(mesh);
        this.meshes[ci] = mesh;
      }
    }
    this.faces += faces - prevFaces;
    this.builtVersion[ci] = chunk.version;
    chunk.dirty = false;
  }

  /** Context restore: every chunk is rebuilt (spread over the following frames). */
  markAllDirty(): void {
    for (const c of this.world.chunks) c.dirty = true;
  }

  /** Mesh of chunk (cx, cz) or null when it is empty / not built yet. */
  meshOf(cx: number, cz: number): Mesh | null {
    return this.meshes[chunkIndex(cx, cz)] ?? null;
  }

  /** Number of chunks currently holding a mesh. */
  get meshCount(): number {
    let n = 0;
    for (const m of this.meshes) if (m) n++;
    return n;
  }

  dispose(): void {
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      if (!m) continue;
      this.parent.remove(m);
      m.geometry.dispose();
      this.meshes[i] = null;
    }
    this.material.dispose();
    this.faces = 0;
  }
}
