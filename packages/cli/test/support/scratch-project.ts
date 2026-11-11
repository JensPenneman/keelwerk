import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { createFakeHost } from './fake-host.ts';
import { runCliWith } from './run-cli-with.ts';

const scratchParent = fileURLToPath(new URL('../.scratch', import.meta.url));

/** The app file of the scratch project: one app without modules and one API version. */
export const demoApp = `import { type AppType, defineApiVersions, defineApp } from '@keelwerk/core';

const demoDef = defineApp({
  id: 'demo',
  modules: [],
  api: defineApiVersions({ '2026-11-04': {} }),
});

export interface Demo extends AppType<typeof demoDef> {}
export const demo: Demo = demoDef;
`;

/** The base of a module the manifest generator reads: a literal id and the exported base. */
export const demoBase = `import { defineModuleBase } from '@keelwerk/core';

export const demoBase = defineModuleBase({ id: 'demo', version: '0.1.0' });
`;

/** A project the commands run in, inside this package so its sources resolve `@keelwerk/core`. */
export interface ScratchProject {
  readonly root: string;
  write(files: Readonly<Record<string, string>>): Promise<void>;
  run(...argv: string[]): ReturnType<typeof runCliWith>;
  /** A copy of the project in a new directory: the sources are imported once per directory, so a change of definitions needs one. */
  fork(): Promise<ScratchProject>;
}

/** Registers the hooks that make and remove the projects; call it at the top of a test file. Each caller removes only the directories it made: the shared parent stays, ignored by git. */
export function useScratchProject(): () => Promise<ScratchProject> {
  const made: string[] = [];
  afterEach(async () => {
    for (const directory of made.splice(0)) await rm(directory, { recursive: true, force: true });
  });
  const bind = (root: string): ScratchProject => ({
    root,
    write: async (files) => {
      for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      }
    },
    run: (...argv) =>
      runCliWith(
        argv,
        createFakeHost({
          cwd: root,
          files: { [`${root}/pnpm-workspace.yaml`]: 'packages:\n  - packages/*\n' },
        }).host,
      ),
    fork: async () => {
      const copy = await create();
      await cp(root, copy, { recursive: true });
      return bind(copy);
    },
  });
  const create = async (): Promise<string> => {
    await mkdir(scratchParent, { recursive: true });
    const root = await mkdtemp(join(scratchParent, 'project-'));
    made.push(root);
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    return root;
  };
  return async () => bind(await create());
}
