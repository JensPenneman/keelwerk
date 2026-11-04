import type { ImportEntry } from './import-entry.ts';

function bare(name: string): string {
  return name.replace(/^type /, '');
}

function order(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' }) || (a < b ? -1 : 1);
}

/** Import statements sorted the way Biome sorts them: packages first, then relative paths. */
export function renderImports(entries: readonly ImportEntry[]): string {
  const merged = new Map<string, Set<string>>();
  for (const entry of entries) {
    const names = merged.get(entry.from) ?? new Set<string>();
    for (const name of entry.names) {
      names.add(name);
    }
    merged.set(entry.from, names);
  }
  const rank = (from: string): number => (from.startsWith('.') ? 1 : 0);
  return [...merged.entries()]
    .toSorted(([a], [b]) => rank(a) - rank(b) || order(a, b))
    .map(([from, names]) => {
      const sorted = [...names].toSorted((a, b) => order(bare(a), bare(b)));
      if (sorted.every((name) => name.startsWith('type '))) {
        return `import type { ${sorted.map(bare).join(', ')} } from '${from}';`;
      }
      return `import { ${sorted.join(', ')} } from '${from}';`;
    })
    .join('\n');
}
