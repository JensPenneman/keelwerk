import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach } from 'vitest';
import { createFakeHost } from './fake-host.ts';
import { runCliWith } from './run-cli-with.ts';

const libraryFixture = fileURLToPath(
  new URL('../../../testing/src/fixtures/modules/library', import.meta.url),
);

/** A scratch workspace per test, and the helpers that run `keelwerk new` in it. */
export interface NewWorkspace {
  readonly root: () => string;
  runNew(...argv: string[]): ReturnType<typeof runCliWith>;
  listing(directory: string): Promise<string[]>;
  snapshot(directory: string): Promise<Map<string, string>>;
  read(path: string): Promise<string>;
  libraryCopy(): Promise<string>;
}

/** Registers the hooks that create and remove the workspace; call it at the top of a test file. */
export function useNewWorkspace(parent: string = tmpdir()): NewWorkspace {
  let workspace = '';
  beforeEach(async () => {
    await mkdir(parent, { recursive: true });
    workspace = await mkdtemp(join(parent, 'keelwerk-new-'));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const listing = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
      .toSorted();
  };
  return {
    root: () => workspace,
    runNew: (...argv) => runCliWith(['new', ...argv], createFakeHost({ cwd: workspace }).host),
    listing,
    snapshot: async (directory) => {
      const found = new Map<string, string>();
      for (const path of await listing(directory)) {
        found.set(path, await readFile(join(directory, path), 'utf8'));
      }
      return found;
    },
    read: (path) => readFile(join(workspace, path), 'utf8'),
    libraryCopy: async () => {
      const target = join(workspace, 'modules', 'library');
      await mkdir(join(workspace, 'modules'), { recursive: true });
      await writeFile(join(workspace, 'package.json'), '{ "name": "@acme/workspace" }\n');
      await cp(libraryFixture, target, { recursive: true });
      return target;
    },
  };
}
