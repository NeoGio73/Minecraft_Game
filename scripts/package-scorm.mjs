#!/usr/bin/env node
/**
 * Path B package: dist/ + generated imsmanifest.xml + the four SCORM 1.2 XSDs
 * -> release/orgocraft-v<version>-scorm12.zip, everything at the zip ROOT (no
 * wrapping folder), for Content -> Upload/Create -> New SCORM/xAPI Object.
 *
 * `buildManifest` and `listDistFiles` are exported so the manifest builder is
 * unit-tested; `main()` runs when executed directly. `--no-xsd` builds a
 * package without the control files (a warning is printed).
 * Spec: docs/design/08-deployment.md §10.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkRelativePaths, listFiles } from './check-relative-paths.mjs';
import {
  DIST_DIR,
  PackagingError,
  RELEASE_DIR,
  ROOT,
  SEMVER_RE,
  assertDistFresh,
  prepareRelease,
  readConfig,
  readZipEntryNames,
  writeZip,
} from './package-d2l.mjs';

export const TEMPLATE_PATH = join(ROOT, 'scorm', 'imsmanifest.template.xml');
export const XSD_DIR = join(ROOT, 'scorm', 'xsd');
/** The four SCORM 1.2 control files that sit at the package root (§10.2). */
export const XSD_FILES = ['imscp_rootv1p1p2.xsd', 'adlcp_rootv1p2.xsd', 'imsmd_rootv1p2p1.xsd', 'ims_xml.xsd'];

export function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function xmlUnescape(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

/** = listFiles: forward slashes, relative, sorted, index.html first. */
export function listDistFiles(dir) {
  return listFiles(dir);
}

function orderFiles(files) {
  const unique = Array.from(new Set(files.map((f) => String(f).replace(/\\/g, '/').replace(/^\.\//, ''))));
  unique.sort((a, b) => {
    if (a === 'index.html') return -1;
    if (b === 'index.html') return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return unique;
}

/** Fills {{VERSION}}, {{MASTERY}} and {{FILES}}; throws on a bad version, a
 *  bad mastery score, a missing index.html or a leftover placeholder. */
export function buildManifest({ template, files, mastery, version }) {
  if (typeof template !== 'string' || template.length === 0) throw new PackagingError('manifest template is empty');
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    throw new PackagingError(`manifest version must be semver, got ${JSON.stringify(version)}`);
  }
  const masteryOk =
    (typeof mastery === 'number' && Number.isInteger(mastery)) ||
    (typeof mastery === 'string' && /^\d+$/.test(mastery));
  const m = masteryOk ? Number(mastery) : NaN;
  if (!Number.isInteger(m) || m < 0 || m > 100) {
    throw new PackagingError(`masteryscore must be an integer 0..100, got ${JSON.stringify(mastery)}`);
  }
  const ordered = orderFiles(Array.isArray(files) ? files : []);
  if (ordered[0] !== 'index.html') throw new PackagingError('dist/ has no index.html - run npm run build');
  const fileLines = ordered.map((f) => `      <file href="${xmlEscape(f)}"/>`).join('\n');
  const manifest = template
    .replace(/\{\{VERSION\}\}/g, xmlEscape(version))
    .replace(/\{\{MASTERY\}\}/g, String(m))
    .replace(/\{\{FILES\}\}/g, fileLines);
  if (manifest.includes('{{')) {
    const left = manifest.match(/\{\{[^}]*\}\}/g) ?? [];
    throw new PackagingError(`manifest template has unknown placeholders: ${left.join(', ')}`);
  }
  const firstFile = manifest.match(/<file href="([^"]*)"\s*\/>/);
  if (!firstFile || firstFile[1] !== 'index.html') throw new PackagingError('index.html is not the first <file> entry');
  return manifest;
}

/** Every href of a generated manifest (`<file href>` entries and the resource href), unescaped. */
export function manifestHrefs(manifest) {
  const out = new Set();
  for (const m of manifest.matchAll(/<file href="([^"]*)"\s*\/>/g)) out.add(xmlUnescape(m[1]));
  for (const m of manifest.matchAll(/<resource\b[^>]*\bhref="([^"]*)"/g)) out.add(xmlUnescape(m[1]));
  return Array.from(out);
}

/** Builds release/orgocraft-v<version>-scorm12.zip; throws PackagingError on any problem. */
export async function main(argv = process.argv.slice(2)) {
  const noXsd = argv.includes('--no-xsd');
  const { version, passMark } = readConfig();
  const check = checkRelativePaths(DIST_DIR);
  if (!check.ok) throw new PackagingError(check.problems.join('\n'));
  assertDistFresh();
  const files = listDistFiles(DIST_DIR);
  if (!existsSync(TEMPLATE_PATH)) throw new PackagingError(`missing ${TEMPLATE_PATH}`);
  const manifest = buildManifest({
    template: readFileSync(TEMPLATE_PATH, 'utf8'),
    files,
    mastery: passMark,
    version,
  });

  const entries = [{ name: 'imsmanifest.xml', content: manifest }];
  if (noXsd) {
    console.warn(
      'warning: --no-xsd: the package omits the SCORM 1.2 control files; 1EdTech packaging says referenced XSDs must be at the root',
    );
  } else {
    for (const name of XSD_FILES) {
      const p = join(XSD_DIR, name);
      if (!existsSync(p)) throw new PackagingError(`missing scorm/xsd/${name} - see docs/design/08-deployment.md §10.2`);
      entries.push({ name, source: p });
    }
  }
  for (const f of files) entries.push({ name: f, source: join(DIST_DIR, f) });

  const outName = `orgocraft-v${version}-scorm12.zip`;
  const outPath = join(RELEASE_DIR, outName);
  prepareRelease(outPath);
  await writeZip(outPath, entries);

  const names = readZipEntryNames(outPath);
  if (names[0] !== 'imsmanifest.xml') throw new PackagingError('imsmanifest.xml is not the first zip entry');
  const present = new Set(names);
  const missing = manifestHrefs(manifest).filter((h) => !present.has(h));
  if (missing.length > 0) throw new PackagingError(`manifest references files missing from the zip: ${missing.join(', ')}`);
  const backslash = names.filter((n) => n.includes('\\'));
  if (backslash.length > 0) throw new PackagingError(`zip entries with backslashes: ${backslash.join(', ')}`);
  if (names.length !== entries.length) {
    throw new PackagingError(`zip holds ${names.length} entries, expected ${entries.length}`);
  }
  statSync(outPath);
  const shown = `release/${outName}`;
  console.log(`wrote ${shown} (masteryscore ${passMark}, ${names.length} files)`);
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
