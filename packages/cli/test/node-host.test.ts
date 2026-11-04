import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { nodeHostFiles } from '../src/host/node-host-files.ts';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test('the real file system writes with exactly mode 0600, even over a looser file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'keelwerk-cli-'));
  directories.push(directory);
  const path = join(directory, 'config', 'keelwerk', 'credentials.json');
  await nodeHostFiles.writeText(path, '{}', 0o600);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(directory, 'config'))).mode & 0o777).toBe(0o700);
  await writeFile(path, 'old', { mode: 0o644 });
  await nodeHostFiles.writeText(path, 'new', 0o600);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await nodeHostFiles.readText(path)).toBe('new');
  expect(await nodeHostFiles.readText(join(directory, 'missing'))).toBeUndefined();
  expect(await nodeHostFiles.exists(path)).toBe(true);
});
