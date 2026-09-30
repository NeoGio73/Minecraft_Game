#!/usr/bin/env node
/**
 * Path A package: dist/ -> release/orgocraft-v<version>-d2l.zip whose only
 * top-level entry is the folder orgocraft-v<version>/ (uploaded to Manage
 * Files, unzipped, index.html added as a Content topic).
 *
 * Also exports the packaging helpers shared with scripts/package-scorm.mjs
 * (config reading, staleness check, reproducible zip writing, central-directory
 * read-back). Spec: docs/design/08-deployment.md §9.
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import archiver from 'archiver';
import { checkRelativePaths, listFiles } from './check-relative-paths.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DIST_DIR = join(ROOT, 'dist');
export const RELEASE_DIR = join(ROOT, 'release');
export const CONFIG_PATH = join(ROOT, 'orgocraft.config.json');
/** Stable timestamps so CI artifacts are byte-identical across runs. */
export const FIXED_DATE = new Date('2000-01-01T00:00:00Z');
export const SEMVER_RE = /^\d+\.\d+\.\d+$/;
/** Sanity ceiling on a package (D2L's own limit is 2 GB). */
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;

export class PackagingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PackagingError';
  }
}

/** orgocraft.config.json with `version` (semver) and `passMark` (integer 0..100) validated. */
export function readConfig(path = CONFIG_PATH) {
  if (!existsSync(path)) throw new PackagingError(`${path} missing - it holds version and passMark (05-content §1)`);
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new PackagingError(`orgocraft.config.json is not valid JSON: ${e.message}`);
  }
  if (typeof config.version !== 'string' || !SEMVER_RE.test(config.version)) {
    throw new PackagingError('orgocraft.config.json.version must be semver (X.Y.Z)');
  }
  if (!Number.isInteger(config.passMark) || config.passMark < 0 || config.passMark > 100) {
    throw new PackagingError('orgocraft.config.json.passMark must be an integer 0..100');
  }
  return config;
}

function maxMtime(dir) {
  let max = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) max = Math.max(max, maxMtime(p));
    else max = Math.max(max, st.mtimeMs);
  }
  return max;
}

/** Refuses a package built from a stale dist/ (compares src/** and the config with dist/index.html). */
export function assertDistFresh(distDir = DIST_DIR, root = ROOT) {
  const index = join(distDir, 'index.html');
  if (!existsSync(index)) throw new PackagingError('dist/index.html missing - run npm run build');
  const built = statSync(index).mtimeMs;
  let newest = 0;
  const src = join(root, 'src');
  if (existsSync(src)) newest = Math.max(newest, maxMtime(src));
  const config = join(root, 'orgocraft.config.json');
  if (existsSync(config)) newest = Math.max(newest, statSync(config).mtimeMs);
  if (newest > built) throw new PackagingError('dist/ is older than src/ - run npm run build first');
}

/** Writes a zip from `entries`: `{ name, source }` (a file on disk) or `{ name, content }` (a string).
 *  Files are read into memory and appended as buffers: archiver stats
 *  `file()` entries concurrently and would reorder them between runs, and the
 *  packages must be byte-identical across runs (and imsmanifest.xml first). */
export function writeZip(outPath, entries) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolvePromise());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
    archive.pipe(output);
    for (const entry of entries) {
      const opts = { name: entry.name, date: FIXED_DATE, mode: 0o644 };
      const data = entry.content !== undefined ? Buffer.from(entry.content, 'utf8') : readFileSync(entry.source);
      archive.append(data, opts);
    }
    archive.finalize().catch(reject);
  });
}

/** Entry names from the zip's central directory (End-Of-Central-Directory walk; no dependency). */
export function readZipEntryNames(zipPath) {
  const buf = readFileSync(zipPath);
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  const EOCD_MIN = 22;
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - EOCD_MIN - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new PackagingError(`${zipPath}: end-of-central-directory record not found`);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new PackagingError(`${zipPath}: zip64 archive; expected a small classic zip`);
  }
  const names = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) {
      throw new PackagingError(`${zipPath}: corrupt central directory entry ${i}`);
    }
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function prepareRelease(outPath) {
  mkdirSync(RELEASE_DIR, { recursive: true });
  rmSync(outPath, { force: true });
}

export function kb(bytes) {
  return Math.round(bytes / 1024);
}

/** Builds release/orgocraft-v<version>-d2l.zip; throws PackagingError on any problem. */
export async function main() {
  const { version } = readConfig();
  const check = checkRelativePaths(DIST_DIR);
  if (!check.ok) throw new PackagingError(check.problems.join('\n'));
  assertDistFresh();
  const files = listFiles(DIST_DIR);
  const folder = `orgocraft-v${version}`;
  const outPath = join(RELEASE_DIR, `${folder}-d2l.zip`);
  prepareRelease(outPath);
  await writeZip(
    outPath,
    files.map((f) => ({ name: `${folder}/${f}`, source: join(DIST_DIR, f) })),
  );
  const names = readZipEntryNames(outPath);
  if (names.length !== files.length) {
    throw new PackagingError(`zip holds ${names.length} entries, expected ${files.length}`);
  }
  const stray = names.filter((n) => !n.startsWith(`${folder}/`));
  if (stray.length > 0) throw new PackagingError(`entries outside ${folder}/: ${stray.join(', ')}`);
  const bytes = statSync(outPath).size;
  if (bytes >= MAX_ZIP_BYTES) throw new PackagingError(`zip is ${kb(bytes)} kB; expected under ${kb(MAX_ZIP_BYTES)} kB`);
  const shown = `release/${folder}-d2l.zip`;
  console.log(`wrote ${shown} (${files.length} files, ${kb(bytes)} kB)`);
  return shown;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e instanceof PackagingError ? e.message : e);
      process.exit(1);
    },
  );
}
