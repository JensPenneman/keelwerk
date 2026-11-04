// Writes src/module.generated.ts of every module root in the workspace, or with --check says
// which ones have drifted (architecture 13.7 and 23.5). `pnpm manifests` runs it.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { checkModuleManifest } from '../packages/core/src/manifest/check-module-manifest.ts';
import { renderModuleManifest } from '../packages/core/src/manifest/render-module-manifest.ts';
import { scanModuleDirectory } from '../packages/core/src/manifest/scan-module-directory.ts';
import { writeModuleManifest } from '../packages/core/src/manifest/write-module-manifest.ts';
import { camelFromKebab } from '../packages/core/src/naming/camel-from-kebab.ts';
import { version } from '../packages/core/src/version.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEARCHED = ['packages', 'examples'];
const SKIPPED = new Set(['node_modules', 'dist']);
// The module roots of S-13: packages/module-*, **/fixtures/modules/*, examples/*/modules/*.
const MODULE_ROOTS: readonly RegExp[] = [
  /^packages\/module-[^/]+$/,
  /(^|\/)fixtures\/modules\/[^/]+$/,
  /^examples\/[^/]+\/modules\/[^/]+$/,
];

async function walk(directory: string, found: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIPPED.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    const shown = relative(root, path).split(sep).join('/');
    if (
      MODULE_ROOTS.some((pattern) => pattern.test(shown)) &&
      existsSync(join(path, 'src', 'base.ts'))
    ) {
      found.push(path);
    } else {
      await walk(path, found);
    }
  }
}

async function listing(source: string): Promise<string[]> {
  const entries = await readdir(source, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(source, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

const roots: string[] = [];
for (const searched of SEARCHED) {
  if (existsSync(join(root, searched))) await walk(join(root, searched), roots);
}

const check = process.argv.includes('--check');
const failures: string[] = [];
for (const moduleRoot of roots.toSorted()) {
  const shown = relative(root, moduleRoot).split(sep).join('/');
  const source = join(moduleRoot, 'src');
  const base = await readFile(join(source, 'base.ts'), 'utf8');
  const id = /\bid:\s*'([a-z][a-z0-9]*(?:-[a-z0-9]+)*)'/.exec(base)?.[1];
  if (id === undefined || !base.includes(`export const ${camelFromKebab(id)}Base`)) {
    process.stderr.write(`${shown}: src/base.ts must declare a literal id and export <id>Base\n`);
    failures.push(shown);
    continue;
  }
  const scanned = scanModuleDirectory(await listing(source));
  for (const file of scanned.unplaced) {
    process.stderr.write(`${shown}: ${file.path} stays unmounted: ${file.reason}\n`);
  }
  const text = renderModuleManifest({
    id,
    generatorVersion: version,
    scanned,
    migrations: existsSync(join(moduleRoot, 'migrations')),
  });
  const target = join(source, 'module.generated.ts');
  if (check) {
    const result = await checkModuleManifest(target, id, text);
    for (const problem of result.problems) process.stderr.write(`${problem}\n`);
    if (!result.current) failures.push(shown);
  } else if (await writeModuleManifest(target, text)) {
    process.stdout.write(`${shown}/src/module.generated.ts written\n`);
  }
}
process.exitCode = failures.length > 0 ? 1 : 0;
