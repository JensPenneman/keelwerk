import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { layoutPass } from '../src/layout/layout-pass.ts';
import { parseSource } from '../src/layout/parse-source.ts';
import clean from './layout-fixtures/clean.json' with { type: 'json' };
import { materialise, removeTrees, writeManifests } from './layout-fixtures/materialise-tree.ts';

interface DriftCase {
  readonly title: string;
  readonly set: Readonly<Record<string, string>>;
  readonly remove: readonly string[];
  readonly regenerate: boolean;
  readonly expect: readonly { kind: string; path: string; message: string }[];
}

const here = dirname(fileURLToPath(import.meta.url));
const directory = join(here, 'layout-fixtures');
const cases: readonly (DriftCase & { name: string })[] = readdirSync(directory)
  .filter((file) => file.endsWith('.json') && file !== 'clean.json')
  .toSorted()
  .map((file) => ({
    name: file.replace(/\.json$/, ''),
    ...(JSON.parse(readFileSync(join(directory, file), 'utf8')) as DriftCase),
  }));

async function build(drift: DriftCase | undefined): Promise<string> {
  const root = await materialise(clean.files);
  await writeManifests(root);
  if (drift === undefined) return root;
  const { rm, writeFile, mkdir } = await import('node:fs/promises');
  for (const path of drift.remove) await rm(join(root, path));
  for (const [path, text] of Object.entries(drift.set)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  if (drift.regenerate) await writeManifests(root);
  return root;
}

async function digest(root: string): Promise<string> {
  const hash = createHash('sha256');
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries
    .filter((candidate) => candidate.isFile())
    .toSorted((a, b) => (join(a.parentPath, a.name) < join(b.parentPath, b.name) ? -1 : 1))) {
    const path = join(entry.parentPath, entry.name);
    hash.update(path).update(await readFile(path));
  }
  return hash.digest('hex');
}

afterEach(removeTrees);

describe('the layout pass on fixtures', () => {
  test('a workspace in the conventions has no finding', async () => {
    expect(await layoutPass(await build(undefined))).toEqual([]);
  });

  test.each(cases)('$title ($name)', async (drift) => {
    const findings = await layoutPass(await build(drift));
    expect(findings.map((finding) => ({ kind: finding.kind, path: finding.path }))).toEqual(
      drift.expect.map((entry) => ({ kind: entry.kind, path: entry.path })),
    );
    for (const entry of drift.expect) {
      const found = findings.find(
        (finding) => finding.kind === entry.kind && finding.path === entry.path,
      );
      expect(found?.message).toContain(entry.message);
      expect(found?.fix).not.toBe('');
    }
  });

  test('every drift kind of section 23.13 is covered', () => {
    const kinds = new Set(cases.flatMap((drift) => drift.expect.map((entry) => entry.kind)));
    expect([...kinds].toSorted()).toEqual(['mounts', 'names', 'packages', 'placement']);
  });

  test('the pass never edits', async () => {
    const root = await build(cases.find((drift) => drift.name === 'mounts-manifest-out-of-date'));
    const before = await digest(root);
    expect((await layoutPass(root)).length).toBeGreaterThan(0);
    expect(await digest(root)).toBe(before);
  });
});

describe('the layout pass on this repository', () => {
  test('reports no finding', async () => {
    const root = join(here, '..', '..', '..');
    expect(await layoutPass(root)).toEqual([]);
  });
});

describe('parseSource', () => {
  test('reads exports, calls, annotations and imports with the compiler API', () => {
    const source = parseSource(
      'x.ts',
      [
        "import { accounts } from '@acme/module-accounts';",
        "import { defineModuleBase } from '@keelwerk/core';",
        "const def = defineModuleBase({ id: 'shop', optional: [accounts], entities: { order } });",
        'export interface ShopBase {}',
        'export const shopBase: ShopBase = def;',
        'export const loose = defineModuleBase({ id: "x" });',
      ].join('\n'),
    );
    expect(source.types).toEqual(['ShopBase']);
    expect(
      source.values.map((value) => [value.name, value.annotation, value.call?.callee]),
    ).toEqual([
      ['shopBase', 'named', 'defineModuleBase'],
      ['loose', 'inferred', 'defineModuleBase'],
    ]);
    expect(source.imports.get('accounts')).toBe('@acme/module-accounts');
    const call = source.values[0]?.call?.args[0];
    expect(call?.kind === 'object' && call.facts.strings.get('id')).toBe('shop');
    expect(call?.kind === 'object' && call.facts.names.get('optional')).toEqual(['accounts']);
    expect(source.defaultExport).toBe(false);
  });
});
