import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { deriveApps } from '../src/producers/derive-apps.ts';
import { migrationTargets } from '../src/producers/migration-targets.ts';
import { moduleDirectories } from '../src/producers/module-directories.ts';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const scratch: string[] = [];

async function workspace(roots: readonly (readonly [string, string])[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'keelwerk-roots-'));
  scratch.push(root);
  for (const [path, id] of roots) {
    await mkdir(join(root, path, 'src'), { recursive: true });
    await writeFile(join(root, path, 'src', 'base.ts'), `export const base = { id: '${id}' };\n`);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('moduleDirectories', () => {
  test('a fixture root never shadows a workspace package with the same id', async () => {
    const root = await workspace([
      ['packages/core/test/fixtures/modules/auth', 'auth'],
      ['packages/module-auth', 'auth'],
    ]);
    expect((await moduleDirectories(root)).get('auth')).toBe(join(root, 'packages/module-auth'));
  });

  test('a fixture root stands for its id when no package has it', async () => {
    const root = await workspace([['packages/core/test/fixtures/modules/billing', 'billing']]);
    expect((await moduleDirectories(root)).get('billing')).toBe(
      join(root, 'packages/core/test/fixtures/modules/billing'),
    );
  });

  test('two non-fixture roots with one id fail, naming both', async () => {
    const root = await workspace([
      ['packages/module-auth', 'auth'],
      ['modules/auth', 'auth'],
    ]);
    await expect(moduleDirectories(root)).rejects.toThrow(
      /auth.*modules\/auth.*packages\/module-auth|auth.*packages\/module-auth.*modules\/auth/,
    );
  });

  test('in this workspace the auth id is the module package, and its own track is a target', async () => {
    expect((await moduleDirectories(repository)).get('auth')).toBe(
      join(repository, 'packages/module-auth'),
    );
    const { apps } = await deriveApps(repository);
    const targets = await migrationTargets(repository, apps, true);
    expect(targets.map((target) => target.directory)).toContain(
      join(repository, 'packages/module-auth/migrations/own'),
    );
  }, 120_000);
});
