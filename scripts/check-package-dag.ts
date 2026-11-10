import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Which `@keelwerk/*` packages each package directory may depend on at run time (section 22, M2 rule 9); `*` ends a prefix. */
const allowedByDirectory: readonly (readonly [string, readonly string[]])[] = [
  ['core', []],
  ['data', ['core']],
  ['adapter-*', ['core', 'data']],
  ['events', ['core']],
  ['live', ['core']],
  ['transport-*', ['core']],
  ['client', ['core']],
  ['cli', ['core', 'data', 'client']],
  ['testing', ['core', 'data', 'client']],
  ['module-*', ['core', 'module-*']],
  ['type-budgets', ['core', 'module-*']],
  ['biome-config', []],
];

const runtimeFields = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;
const scope = '@keelwerk/';
const skippedDirectories = new Set(['node_modules', 'dist']);
const importStatement = /^(?:import|export)\b[\w\s{},*$]*?\bfrom\s*(['"])([^'"]+)\1/;
const bareImport = /^import\s*(['"])([^'"]+)\1/;
const leadingTrivia = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)+/;

type Manifest = Partial<Record<(typeof runtimeFields)[number] | 'devDependencies', unknown>>;

function matches(pattern: string, name: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

function allowedOf(directory: string): readonly string[] | undefined {
  return allowedByDirectory.find(([pattern]) => matches(pattern, directory))?.[1];
}

function permits(allowed: readonly string[], directory: string, name: string): boolean {
  return name === directory || allowed.some((pattern) => matches(pattern, name));
}

function workspaceNamesIn(field: unknown): readonly string[] {
  if (typeof field !== 'object' || field === null) return [];
  return Object.keys(field)
    .filter((name) => name.startsWith(scope))
    .map((name) => name.slice(scope.length));
}

async function readManifest(path: string): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

async function typeScriptFilesUnder(directory: string): Promise<readonly string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await typeScriptFilesUnder(path)));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

/** The module specifiers of the statements at the top of a file, up to the first other statement. */
function leadingSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  let rest = source;
  for (;;) {
    rest = rest.replace(leadingTrivia, '');
    const statement = importStatement.exec(rest) ?? bareImport.exec(rest);
    const specifier = statement?.[2];
    if (statement === null || specifier === undefined) return specifiers;
    specifiers.push(specifier);
    rest = rest.slice(statement[0].length).replace(/^\s*;?/, '');
  }
}

function isRuntimeFile(directory: string, relative: string): boolean {
  if (directory === 'core') return true;
  return (
    relative.startsWith('src/') &&
    !relative.endsWith('.test.ts') &&
    !relative.endsWith('.test-d.ts') &&
    !relative.endsWith('.bench.ts')
  );
}

function cyclesIn(edges: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const found = new Set<string>();
  const walk = (node: string, trail: readonly string[]): void => {
    const at = trail.indexOf(node);
    if (at >= 0) {
      const loop = trail.slice(at);
      const first = loop.indexOf([...loop].sort()[0] ?? node);
      const turned = [...loop.slice(first), ...loop.slice(0, first)];
      found.add(`cycle: ${[...turned, turned[0]].map((name) => scope + name).join(' -> ')}`);
      return;
    }
    for (const next of edges.get(node) ?? []) walk(next, [...trail, node]);
  };
  for (const node of [...edges.keys()].sort()) walk(node, []);
  return [...found];
}

/**
 * The package graph of section 22 and M2 rule 9 over `<root>/packages/*`. Answers one line per
 * violation, sorted; empty when the graph holds. Reads files only.
 */
export async function checkPackageDag(root: string): Promise<readonly string[]> {
  const violations: string[] = [];
  const edges = new Map<string, readonly string[]>();
  const packagesDirectory = join(root, 'packages');
  const directories = (await readdir(packagesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const directory of directories) {
    const allowed = allowedOf(directory);
    if (allowed === undefined) {
      violations.push(`packages/${directory}: no rule in the package graph (section 22)`);
      continue;
    }
    const packageDirectory = join(packagesDirectory, directory);
    const manifest = await readManifest(join(packageDirectory, 'package.json'));
    const runtime: string[] = [];
    for (const field of runtimeFields) {
      for (const name of workspaceNamesIn(manifest[field])) {
        if (!permits(allowed, directory, name)) {
          violations.push(`packages/${directory}: depends on ${scope}${name} (${field})`);
        }
        if (name !== directory) runtime.push(name);
      }
    }
    edges.set(directory, runtime);
    if (directory === 'core') {
      for (const name of workspaceNamesIn(manifest.devDependencies)) {
        violations.push(`packages/core: depends on ${scope}${name} (devDependencies)`);
      }
    }
    for (const path of await typeScriptFilesUnder(packageDirectory)) {
      const relative = path.slice(packageDirectory.length + 1);
      if (!isRuntimeFile(directory, relative)) continue;
      const imported = new Set<string>();
      for (const specifier of leadingSpecifiers(await readFile(path, 'utf8'))) {
        if (!specifier.startsWith(scope)) continue;
        const name = specifier.slice(scope.length).split('/')[0] ?? '';
        if (!permits(allowed, directory, name)) imported.add(name);
      }
      for (const name of imported) {
        violations.push(`packages/${directory}/${relative}: imports ${scope}${name}`);
      }
    }
  }
  violations.push(...cyclesIn(edges));
  return violations.sort();
}
