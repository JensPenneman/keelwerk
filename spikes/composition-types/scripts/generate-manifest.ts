import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Entry {
  readonly importName: string;
  readonly exportName: string;
  readonly path: string;
}
interface Tree {
  readonly [key: string]: Tree | Entry;
}

const flatSections: Readonly<Record<string, string>> = {
  actions: 'actions',
  reactions: 'reactions',
  services: 'services',
  lifecycle: 'lifecycle',
  effects: 'effects',
  executors: 'executors',
  schedules: 'schedules',
  topics: 'topics',
  changes: 'changes',
  fills: 'extensionPoints',
};
const nestedSections: Readonly<Record<string, string>> = {
  'entity-actions': 'entityActions',
  policies: 'policies',
};

const camel = (kebab: string): string =>
  kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (kebab: string): string => {
  const name = camel(kebab);
  return name.charAt(0).toUpperCase() + name.slice(1);
};
const isPart = (file: string): boolean =>
  file.endsWith('.ts') && !file.includes('.test') && !file.endsWith('.generated.ts');
const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();
const listing = (dir: string): readonly string[] =>
  isDir(dir) ? [...readdirSync(dir)].sort() : [];

function entry(root: string, path: string): Entry {
  const relativePath = path.slice(root.length + 1).replace(/\.ts$/, '');
  const file = relativePath.split('/').at(-1) ?? relativePath;
  return {
    importName: camel(relativePath.replaceAll('/', '-')),
    exportName: camel(file),
    path: `./${relativePath}.ts`,
  };
}

/** One level of parts (`actions/<name>.ts`), or two (`policies/<target>/<rule>.ts`, also accepting `policies/<rule>.ts`). */
function collect(root: string, dir: string, nested: boolean): Tree {
  const tree: Record<string, Tree | Entry> = {};
  for (const name of listing(dir)) {
    const path = join(dir, name);
    if (nested && isDir(path)) tree[camel(name)] = collect(root, path, false);
    else if (isPart(name)) tree[camel(name.replace(/\.ts$/, ''))] = entry(root, path);
  }
  return tree;
}

function sections(root: string, dir: string): Tree {
  const tree: Record<string, Tree> = {};
  for (const [directory, key] of Object.entries(flatSections)) {
    const parts = collect(root, join(dir, directory), false);
    if (Object.keys(parts).length > 0) tree[key] = parts;
  }
  for (const [directory, key] of Object.entries(nestedSections)) {
    const parts = collect(root, join(dir, directory), true);
    if (Object.keys(parts).length > 0) tree[key] = parts;
  }
  return tree;
}

function declarations(root: string, dir: string): Tree {
  const tree: Record<string, Tree> = {};
  for (const name of listing(dir)) {
    const behaviour = isDir(join(dir, name)) ? sections(root, join(dir, name)) : {};
    if (Object.keys(behaviour).length > 0) tree[camel(name)] = behaviour;
  }
  return tree;
}

function entries(tree: Tree): readonly Entry[] {
  return Object.values(tree).flatMap((value) =>
    'path' in value ? [value as Entry] : entries(value as Tree),
  );
}

function literal(tree: Tree, indent: string): string {
  const inner = `${indent}  `;
  const lines = Object.entries(tree).map(([key, value]) =>
    'path' in value
      ? `${inner}${key}: ${(value as Entry).importName},`
      : `${inner}${key}: ${literal(value as Tree, inner)},`,
  );
  return `{\n${lines.join('\n')}\n${indent}}`;
}

/**
 * Writes the module literal of a module directory, the way `keelwerk generate` would (decision 59b):
 * one import and one entry per part file, keys from the file and directory names.
 */
export function generateManifest(
  dir: string,
  moduleId: string,
  defineModuleImport: string,
): string {
  const tree: Record<string, Tree | Entry> = { ...sections(dir, dir) };
  const contributes = declarations(dir, join(dir, 'contributions'));
  const conditional = declarations(dir, join(dir, 'conditional'));
  if (Object.keys(contributes).length > 0) tree['contributes'] = contributes;
  if (Object.keys(conditional).length > 0) tree['conditional'] = conditional;
  const imports = entries(tree)
    .map((part) => `import { ${part.exportName} as ${part.importName} } from '${part.path}';`)
    .sort();
  const base = `${camel(moduleId)}Base`;
  const typeName = pascal(moduleId);
  return [
    "// Generated from the module's directories (decision 59b); do not edit.",
    `import { defineModule, type ModuleType } from '${defineModuleImport}';`,
    `import { ${base} } from './base.ts';`,
    ...imports,
    '',
    `const moduleDef = defineModule(${base}, ${literal(tree, '')});`,
    '',
    `/** The ${moduleId} module. */`,
    `export interface ${typeName} extends ModuleType<typeof moduleDef> {}`,
    '',
    `/** The ${moduleId} module value. */`,
    `export const ${camel(moduleId)}: ${typeName} = moduleDef;`,
    '',
  ].join('\n');
}
