import { camelFromKebab } from '../naming/camel-from-kebab.ts';
import { pascal } from '../naming/pascal.ts';
import type { ScannedModule, ScannedPart } from './scan-module-directory.ts';

type Node = { readonly leaf: string } | { readonly entries: Entries };
type Entries = [key: string, node: Node][];

const LINE_WIDTH = 100;
const SECTION_ORDER: readonly string[] = [
  'actions',
  'entityActions',
  'policies',
  'reactions',
  'extensionPoints',
  'services',
  'topics',
  'contributes',
  'conditional',
  'schedules',
  'lifecycle',
  'changes',
  'effects',
  'executors',
];
const MIGRATIONS = "new URL('../migrations/', import.meta.url)";

function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const PUNCTUATION = '._-';

/** Biome's order of two characters: punctuation (`.`, `_`, `-`), digits, then letters. */
function compareCharacters(a: string, b: string): number {
  const rank = (character: string): number => {
    const punctuation = PUNCTUATION.indexOf(character);
    if (punctuation >= 0) return punctuation;
    return /\d/.test(character) ? 10 : 20;
  };
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  const lower = compareCodeUnits(a.toLowerCase(), b.toLowerCase());
  if (lower !== 0) return lower;
  return compareCodeUnits(b, a);
}

/** Compares two path segments the way Biome sorts imports: digit runs by value, the rest by character. */
function compareSegments(a: string, b: string): number {
  const tokens = (text: string): string[] => text.match(/\d+|\D/g) ?? [];
  const left = tokens(a);
  const right = tokens(b);
  for (let at = 0; at < Math.min(left.length, right.length); at += 1) {
    const x = left[at] as string;
    const y = right[at] as string;
    const numbers = /^\d/.test(x) && /^\d/.test(y);
    const order = numbers ? Number(x) - Number(y) : compareCharacters(x, y);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

/** Compares two import paths segment by segment, so `x/y.ts` sorts before `x-y.ts`. */
function compareImportPaths(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  for (let at = 0; at < Math.min(left.length, right.length); at += 1) {
    const order = compareSegments(left[at] as string, right[at] as string);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function qualifiers(part: ScannedPart): string[] {
  return [part.scope?.name, part.owner].filter(
    (word): word is string => word !== undefined && word !== '',
  );
}

/** The local name of every part: its export, or an alias where two parts would clash (section 23.5). */
function localNames(parts: readonly ScannedPart[], reserved: ReadonlySet<string>): string[] {
  const groups = new Map<string, number[]>();
  parts.forEach((part, index) => {
    groups.set(part.exportName, [...(groups.get(part.exportName) ?? []), index]);
  });
  const names: string[] = parts.map((part) => part.exportName);
  const used = new Set(reserved);
  const aliased: number[] = [];
  for (const [name, members] of groups) {
    const bare = members.filter((index) => qualifiers(parts[index] as ScannedPart).length === 0);
    const clash = members.length > 1 || reserved.has(name);
    const keeper = !reserved.has(name) && bare.length === 1 ? bare[0] : undefined;
    for (const index of members) {
      if (!clash || index === keeper) used.add(name);
      else aliased.push(index);
    }
  }
  for (const index of aliased.toSorted((a, b) => a - b)) {
    const part = parts[index] as ScannedPart;
    const [head = '', ...tail] = [...qualifiers(part), part.exportName];
    const base = head + tail.map(capital).join('');
    let alias = base === part.exportName ? `${base}${capital(part.kind)}` : base;
    for (let n = 2; used.has(alias); n += 1) alias = `${base}${capital(part.kind)}${n}`;
    names[index] = alias;
    used.add(alias);
  }
  return names;
}

function child(entries: Entries, key: string): Entries {
  const found = entries.find(([name]) => name === key)?.[1];
  if (found !== undefined && 'entries' in found) return found.entries;
  const created: Entries = [];
  entries.push([key, { entries: created }]);
  return created;
}

/** Orders sections in the order of section 23.5 and every other level by key. */
function sortEntries(entries: Entries, level: 'keys' | 'sections' | 'scopes'): void {
  entries.sort(([a], [b]) =>
    level === 'sections'
      ? SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b)
      : compareCodeUnits(a, b),
  );
  for (const [key, node] of entries) {
    if (!('entries' in node)) continue;
    const scoped = level === 'sections' && (key === 'contributes' || key === 'conditional');
    if (scoped) sortEntries(node.entries, 'scopes');
    else sortEntries(node.entries, level === 'scopes' ? 'sections' : 'keys');
  }
}

function inline(node: Node): string {
  if ('leaf' in node) return node.leaf;
  if (node.entries.length === 0) return '{}';
  return `{ ${node.entries.map(([key, value]) => property(key, value, inline)).join(', ')} }`;
}

function property(key: string, node: Node, render: (node: Node) => string): string {
  const text = render(node);
  return 'leaf' in node && node.leaf === key ? key : `${key}: ${text}`;
}

function lines(entries: Entries, depth: number): string[] {
  const pad = '  '.repeat(depth);
  return entries.flatMap(([key, node]) => {
    const flat = `${pad}${property(key, node, inline)},`;
    if ('leaf' in node || flat.length <= LINE_WIDTH) return [flat];
    return [`${pad}${key}: {`, ...lines(node.entries, depth + 1), `${pad}},`];
  });
}

function mountTree(parts: readonly ScannedPart[], names: readonly string[]): Entries {
  const root: Entries = [];
  parts.forEach((part, index) => {
    let entries = root;
    if (part.scope !== undefined) {
      entries = child(child(entries, part.scope.section), part.scope.key);
    }
    entries = child(entries, part.section);
    if (part.owner !== undefined) entries = child(entries, part.owner);
    entries.push([part.key, { leaf: names[index] as string }]);
  });
  return root;
}

/** What the manifest of one module is written from. */
export interface ManifestSource {
  /** The module id, kebab-case; the base exports `<camel id>Base` (section 23.4). */
  readonly id: string;
  /** The version of the generator, named in the header. */
  readonly generatorVersion: string;
  readonly scanned: ScannedModule;
  /** Whether a `migrations/` directory sits beside `src/` (S-08). */
  readonly migrations: boolean;
}

/**
 * Writes `module.generated.ts` for a scanned module (section 23.5): the sorted imports, the
 * literal `defineModule(base, { ... })` and the named type, in the form Biome keeps unchanged.
 * Aliases appear only where two parts share a name. The result is a function of its argument alone.
 */
export function renderModuleManifest(source: ManifestSource): string {
  const { id, scanned } = source;
  const name = camelFromKebab(id);
  const type = pascal(id);
  const base = `${name}Base`;
  const definition = `${name}Def`;
  const parts = scanned.parts;
  const names = localNames(
    parts,
    new Set(['defineModule', 'ModuleType', base, definition, name, type]),
  );
  const imports = [
    ...parts.map((part, index) => ({
      path: part.path,
      specifier:
        names[index] === part.exportName
          ? part.exportName
          : `${part.exportName} as ${names[index]}`,
    })),
    { path: './base.ts', specifier: base },
  ].toSorted((a, b) => compareImportPaths(a.path, b.path));

  const root = mountTree(parts, names);
  sortEntries(root, 'sections');
  if (source.migrations) root.push(['migrations', { leaf: MIGRATIONS }]);
  const open = `const ${definition} = defineModule(${base}, {`;
  const literal = root.length === 0 ? [`${open}});`] : [open, ...lines(root, 1), '});'];

  return `${[
    `// Generated by keelwerk ${source.generatorVersion} from the directories of src/. Do not edit. Format keelwerk.module/1.`,
    "import { defineModule, type ModuleType } from '@keelwerk/core';",
    ...imports.map(({ path, specifier }) => `import { ${specifier} } from '${path}';`),
    '',
    ...literal,
    '',
    `export interface ${type} extends ModuleType<typeof ${definition}> {}`,
    `export const ${name}: ${type} = ${definition};`,
  ].join('\n')}\n`;
}
