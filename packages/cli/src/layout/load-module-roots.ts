import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { coreModuleDirectory } from './core-module-directory.ts';
import type { ModuleRoot } from './layout-workspace.ts';
import { moduleRootPatterns } from './module-root-patterns.ts';
import { parseSource } from './parse-source.ts';
import { parseSources } from './parse-sources.ts';
import type { ParsedSource } from './parsed-source.ts';

async function parseEntry(
  root: string,
  sourceDir: string,
  name: string,
  source: readonly string[],
): Promise<ParsedSource | undefined> {
  if (!source.includes(name)) return undefined;
  const text = await readFile(join(root, sourceDir, name), 'utf8').catch(() => undefined);
  return text === undefined ? undefined : parseSource(`${sourceDir}/${name}`, text);
}

function below(files: readonly string[], prefix: string): readonly string[] {
  return files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
}

function directories(files: readonly string[]): readonly string[] {
  return [...new Set(files.map((file) => file.split('/')[0] ?? ''))].filter(
    (name) => name !== '' && files.some((file) => file.startsWith(`${name}/`)),
  );
}

/** The module roots among `files`: a matching directory with `src/base.ts`, or the `src/module.ts` of a sugar module, and the core module (S-11). */
export async function loadModuleRoots(
  root: string,
  files: readonly string[],
): Promise<readonly ModuleRoot[]> {
  const candidates = new Set(
    files
      .flatMap((file) => [...file.matchAll(/\/src\//g)].map((match) => file.slice(0, match.index)))
      .filter((dir) => moduleRootPatterns.some((pattern) => pattern.test(dir))),
  );
  const modules: ModuleRoot[] = [];
  const roots = [...candidates].toSorted().map((dir) => ({ dir, sourceDir: `${dir}/src` }));
  if (files.some((file) => file.startsWith(`${coreModuleDirectory}/`))) {
    roots.push({ dir: coreModuleDirectory, sourceDir: coreModuleDirectory });
  }
  for (const { dir, sourceDir } of roots) {
    const own = below(files, `${dir}/`);
    const core = dir === coreModuleDirectory;
    const source = core ? own : below(own, 'src/');
    const sugar =
      core ||
      (!source.includes('base.ts') &&
        source.includes('module.ts') &&
        (source.includes('listener.ts') || source.includes('adapter.ts')));
    if (!source.includes('base.ts') && !sugar) continue;
    const sources = await parseSources(root, sourceDir, source);
    const base = sources.get('base.ts')?.values.at(0)?.call?.args;
    const object = base?.find((arg) => arg.kind === 'object');
    const migrations = below(own, 'migrations/');
    modules.push({
      dir,
      sourceDir,
      id: object?.kind === 'object' ? object.facts.strings.get('id') : undefined,
      sugar,
      files: source,
      sources,
      entry: await parseEntry(root, sourceDir, sugar ? 'module.ts' : 'module.generated.ts', source),
      tracks: directories(migrations),
      hasMigrations: own.some((file) => file.startsWith('migrations/')),
    });
  }
  return modules;
}
