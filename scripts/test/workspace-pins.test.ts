import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function readText(path: string): Promise<string> {
  return await readFile(join(root, path), 'utf8');
}

interface Manifest {
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

async function readManifest(path: string): Promise<Manifest> {
  return JSON.parse(await readText(path)) as Manifest;
}

const workspace = await readManifest('package.json');

test('knip.json names the schema of the knip it runs', async () => {
  expect(await readText('knip.json')).toContain(`knip@${workspace.devDependencies?.knip}/`);
});

test('the Biome preset names the schema of the Biome it expects', async () => {
  const peer = (await readManifest('packages/biome-config/package.json')).peerDependencies?.[
    '@biomejs/biome'
  ];
  expect(peer).toBe(workspace.devDependencies?.['@biomejs/biome']);
  expect(await readText('packages/biome-config/preset.jsonc')).toContain(`/schemas/${peer}/`);
});

/** Whether a range of the form `>=low <high` admits the version; every other form admits nothing. */
function admits(range: string, version: string): boolean {
  const match = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(range);
  if (match === null) return false;
  const parts = (text: string): number[] => text.split('.').map(Number);
  const compare = (left: number[], right: number[]): number =>
    (left[0] ?? 0) - (right[0] ?? 0) ||
    (left[1] ?? 0) - (right[1] ?? 0) ||
    (left[2] ?? 0) - (right[2] ?? 0);
  return (
    compare(parts(version), parts(match[1] ?? '')) >= 0 &&
    compare(parts(version), parts(match[2] ?? '')) < 0
  );
}

test('the testing peer range admits the workspace Vitest and its next patch release', async () => {
  const range =
    (await readManifest('packages/testing/package.json')).peerDependencies?.vitest ?? '';
  const pinned = workspace.devDependencies?.vitest ?? '';
  const [major, minor, patch] = pinned.split('.').map(Number);
  expect(admits(range, pinned), range).toBe(true);
  expect(admits(range, `${major}.${minor}.${(patch ?? 0) + 1}`), range).toBe(true);
});
