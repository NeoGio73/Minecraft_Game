#!/usr/bin/env node
/**
 * Verifies that dist/ can be served from a deep D2L Brightspace subfolder
 * (/content/enforced/<orgunit>/orgocraft-v<ver>/): every asset reference must
 * be relative, no file may carry an extension D2L's uploader rejects, and
 * index.html must reference ./assets/ (Vite's `base: './'`).
 *
 * Exports are imported by scripts/package-d2l.mjs and scripts/package-scorm.mjs;
 * `node scripts/check-relative-paths.mjs [distDir]` runs standalone (exit 1 on failure).
 * Spec: docs/design/08-deployment.md §8.2.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** D2L's restricted-extension list, as far as it can meet a web build (docs/research/d2l-hosting.md). */
export const RESTRICTED_EXTENSIONS = ['.sh', '.bat', '.exe', '.dll', '.config', '.cmd', '.ps1', '.jar'];

/** Files scanned for root-absolute URLs. */
export const TEXT_EXTENSIONS = ['.html', '.js', '.css', '.json', '.svg', '.webmanifest'];

/** Root-absolute references that would break under a subfolder. Protocol-relative
 *  `//` and `data:` URLs are not flagged. Every pattern carries the g flag so
 *  `String.prototype.matchAll` can be used on it. */
export const ABSOLUTE_URL_PATTERNS = [
  /\bsrc="\/(?!\/)/g,
  /\bhref="\/(?!\/)/g,
  /\bsrc='\/(?!\/)/g,
  /\bhref='\/(?!\/)/g,
  /["'`]\/assets\//g,
  /url\(\s*["']?\/(?!\/)/g,
  /\bimport\(\s*["']\/(?!\/)/g,
  /\bfetch\(\s*["']\/(?!\/)/g,
  /\bfrom\s+["']\/(?!\/)/g,
  /\bnew URL\(\s*["']\/(?!\/)/g,
];

const DEFAULT_DIST = fileURLToPath(new URL('../dist', import.meta.url));

/** Recursive listing of `dir`: forward slashes, relative to `dir`, sorted, index.html first. */
export function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    const abs = rel === '' ? dir : join(dir, rel);
    for (const name of readdirSync(abs).sort()) {
      const relPath = rel === '' ? name : `${rel}/${name}`;
      if (statSync(join(dir, relPath)).isDirectory()) walk(relPath);
      else out.push(relPath);
    }
  };
  walk('');
  out.sort((a, b) => {
    if (a === 'index.html') return -1;
    if (b === 'index.html') return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Runs every check on `distDir` and returns `{ ok, problems }`; never throws on a missing dist/. */
export function checkRelativePaths(distDir) {
  const problems = [];
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    problems.push('dist/index.html missing - run npm run build');
    return { ok: false, problems };
  }
  const files = listFiles(distDir);
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (RESTRICTED_EXTENSIONS.includes(ext)) problems.push(`restricted extension: ${file}`);
    if (!TEXT_EXTENSIONS.includes(ext)) continue;
    const text = readFileSync(join(distDir, file), 'utf8');
    for (const pattern of ABSOLUTE_URL_PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        problems.push(`${file}:${lineOf(text, m.index ?? 0)}: root-absolute URL "${m[0]}"`);
      }
    }
  }
  const index = readFileSync(indexPath, 'utf8');
  if (!index.includes('src="./assets/') || !index.includes('href="./assets/')) {
    problems.push("index.html does not reference ./assets/ - is base './' set?");
  }
  return { ok: problems.length === 0, problems };
}

export function main(argv = process.argv.slice(2)) {
  const distDir = argv[0] ? resolve(argv[0]) : DEFAULT_DIST;
  const { ok, problems } = checkRelativePaths(distDir);
  if (!ok) {
    for (const p of problems) console.error(p);
    return 1;
  }
  console.log(`check-relative-paths: OK (${listFiles(distDir).length} files)`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exit(main());
}
