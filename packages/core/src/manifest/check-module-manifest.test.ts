import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, describe, expect } from 'vitest';
import { version } from '../version.ts';
import { checkModuleManifest } from './check-module-manifest.ts';
import { renderModuleManifest } from './render-module-manifest.ts';
import { scanModuleDirectory } from './scan-module-directory.ts';
import { writeModuleManifest } from './write-module-manifest.ts';

const FILES = [
  'actions/add-book.ts',
  'actions/find-by-isbn.ts',
  'policies/add-book/signed-in.ts',
  'policies/book/readers.ts',
];

function render(files: readonly string[]): string {
  return renderModuleManifest({
    id: 'library',
    generatorVersion: version,
    scanned: scanModuleDirectory(files),
    migrations: false,
  });
}

const test = base.extend<{ directory: string; manifest: string }>({
  directory: async ({ task }, use) => {
    const directory = await mkdtemp(join(tmpdir(), `keelwerk-manifest-${task.id}-`));
    await use(directory);
    await rm(directory, { recursive: true, force: true });
  },
  manifest: async ({ directory }, use) => {
    await use(join(directory, 'module.generated.ts'));
  },
});

describe('checkModuleManifest', () => {
  test('passes on a manifest written from the same directories', async ({ manifest }) => {
    await writeModuleManifest(manifest, render(FILES));
    expect(await checkModuleManifest(manifest, 'library', render(FILES))).toEqual({
      current: true,
      problems: [],
    });
  });

  test('passes on a manifest whose header names another generator version', async ({
    manifest,
  }) => {
    const text = render(FILES);
    const older = text.replace(`keelwerk ${version} `, 'keelwerk 0.0.0-older ');
    expect(older).not.toBe(text);
    await writeModuleManifest(manifest, older);
    const check = await checkModuleManifest(manifest, 'library', text);
    expect(check).toEqual({ current: true, problems: [] });
  });

  test('names the module and the changed reference when an action file moves', async ({
    manifest,
  }) => {
    await writeModuleManifest(manifest, render(FILES));
    const moved = FILES.map((file) =>
      file === 'actions/add-book.ts' ? 'actions/book/add.ts' : file,
    );
    const result = await checkModuleManifest(manifest, 'library', render(moved));
    expect(result.current).toBe(false);
    expect(result.problems).toEqual([
      'library: library.addBook is now library.book.add (actions/add-book.ts is now actions/book/add.ts)',
    ]);
  });

  test('names a part that is no longer mounted and one that is not mounted yet', async ({
    manifest,
  }) => {
    await writeModuleManifest(manifest, render(FILES));
    const changed = [
      ...FILES.filter((file) => !file.startsWith('policies/')),
      'services/lookup.ts',
    ];
    const { problems } = await checkModuleManifest(manifest, 'library', render(changed));
    expect(problems).toContain(
      'library: library.book.readers (policies/book/readers.ts) is no longer mounted',
    );
    expect(problems).toContain('library: library.lookup (services/lookup.ts) is not mounted yet');
  });

  test('names a part whose file name changed under the same key position', async ({ manifest }) => {
    await writeModuleManifest(manifest, render(FILES));
    const text = (await readFile(manifest, 'utf8')).replace(
      "'./actions/find-by-isbn.ts'",
      "'./actions/lookup.ts'",
    );
    await writeFile(manifest, text, 'utf8');
    const { problems } = await checkModuleManifest(manifest, 'library', render(FILES));
    expect(problems).toEqual([
      'library: library.findByIsbn comes from actions/find-by-isbn.ts, not actions/lookup.ts',
    ]);
  });

  test('fails on a hand edit that moves no mount, and on a missing file', async ({
    directory,
    manifest,
  }) => {
    await writeModuleManifest(manifest, `${render(FILES)}// edited\n`);
    const edited = await checkModuleManifest(manifest, 'library', render(FILES));
    expect(edited.problems).toEqual([expect.stringContaining('differs from the text')]);
    const missing = await checkModuleManifest(join(directory, 'none.ts'), 'library', render(FILES));
    expect(missing.problems).toEqual([expect.stringContaining('does not exist')]);
  });
});

describe('writeModuleManifest', () => {
  test('writes through a rename and leaves an unchanged file alone', async ({
    directory,
    manifest,
  }) => {
    expect(await writeModuleManifest(manifest, 'one\n')).toBe(true);
    const before = await stat(manifest);
    expect(await writeModuleManifest(manifest, 'one\n')).toBe(false);
    expect((await stat(manifest)).mtimeMs).toBe(before.mtimeMs);
    expect(await writeModuleManifest(manifest, 'two\n')).toBe(true);
    expect(await readFile(manifest, 'utf8')).toBe('two\n');
    expect(await readdir(directory)).toEqual(['module.generated.ts']);
  });

  test('a rename of a manifest away is seen as missing', async ({ directory, manifest }) => {
    await writeModuleManifest(manifest, 'x\n');
    await rename(manifest, join(directory, 'other.ts'));
    expect(await writeModuleManifest(manifest, 'x\n')).toBe(true);
  });
});
