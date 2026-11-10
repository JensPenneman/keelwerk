import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { writePublishEngines } from '../write-publish-engines.ts';
import { packageFixture } from './support/package-fixture.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = packageFixture([
    {
      directory: 'a',
      manifest: { name: '@x/a', version: '0.1.0', license: 'MIT', type: 'module' },
    },
    { directory: 'p', manifest: { name: '@x/p', version: '0.1.0', private: true } },
  ]);
  roots.push(root);
  return root;
}

test('writes engines into every publishable manifest', () => {
  const root = fixture();
  expect(writePublishEngines(root)).toEqual(['@x/a']);
  const manifest = JSON.parse(readFileSync(join(root, 'packages/a/package.json'), 'utf8')) as {
    engines: unknown;
  };
  expect(manifest.engines).toEqual({ node: '>=26' });
});

test('leaves a private manifest byte for byte', () => {
  const root = fixture();
  const file = join(root, 'packages/p/package.json');
  const before = readFileSync(file, 'utf8');
  writePublishEngines(root);
  expect(readFileSync(file, 'utf8')).toBe(before);
});

test('keeps every other member in its order and ends with a newline', () => {
  const root = fixture();
  writePublishEngines(root);
  const text = readFileSync(join(root, 'packages/a/package.json'), 'utf8');
  expect(Object.keys(JSON.parse(text) as object)).toEqual([
    'name',
    'version',
    'license',
    'type',
    'engines',
  ]);
  expect(text.endsWith('}\n')).toBe(true);
});

test('a manifest that is not JSON is an error', () => {
  const root = fixture();
  mkdirSync(join(root, 'packages/bad'));
  writeFileSync(join(root, 'packages/bad/package.json'), '{');
  expect(() => writePublishEngines(root)).toThrow();
});

test('the committed manifests carry no engines field', () => {
  for (const entry of ['core', 'cli', 'data']) {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, 'packages', entry, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty('engines');
  }
});

test('every committed manifest names the repository and its own directory', () => {
  const directories = readdirSync(join(repositoryRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  expect(directories.length).toBeGreaterThanOrEqual(20);
  for (const entry of directories) {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, 'packages', entry, 'package.json'), 'utf8'),
    ) as { repository?: unknown };
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/JensPenneman/keelwerk.git',
      directory: `packages/${entry}`,
    });
  }
});
