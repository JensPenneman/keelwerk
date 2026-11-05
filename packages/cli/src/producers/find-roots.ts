import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { shownPath } from './shown-path.ts';
import type { WorkspaceRootKind } from './workspace-root-kind.ts';

const SEARCHED = ['packages', 'examples', 'modules', 'apps'];
const SKIPPED = new Set(['node_modules', 'dist', 'generated']);

// The module roots of S-13, and the canonical layout of 23.1 (`modules/<id>` of a project).
const MODULE_ROOTS: readonly RegExp[] = [
  /^packages\/module-[^/]+$/,
  /(^|\/)fixtures\/modules\/[^/]+$/,
  /^examples\/[^/]+\/modules\/[^/]+$/,
  /^modules\/[^/]+$/,
];

// The app roots: fixtures/apps/*, examples/*/apps/*, and `apps/<app>` of a project (23.1).
const APP_ROOTS: readonly RegExp[] = [
  /(^|\/)fixtures\/apps\/[^/]+$/,
  /^examples\/[^/]+\/apps\/[^/]+$/,
  /^apps\/[^/]+$/,
];

const MARKER: Readonly<Record<WorkspaceRootKind, string>> = { module: 'base.ts', app: 'app.ts' };

async function walk(
  root: string,
  directory: string,
  kind: WorkspaceRootKind,
  found: string[],
): Promise<void> {
  const patterns = kind === 'module' ? MODULE_ROOTS : APP_ROOTS;
  // A directory that vanishes between being listed and being read (a scaffold removed by another
  // process) holds no roots.
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIPPED.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    const shown = shownPath(root, path);
    if (
      patterns.some((pattern) => pattern.test(shown)) &&
      existsSync(join(path, 'src', MARKER[kind]))
    ) {
      found.push(path);
    } else {
      await walk(root, path, kind, found);
    }
  }
}

/** The module roots or the app roots of a workspace (each with its marker file under `src/`), sorted by path. */
export async function findRoots(root: string, kind: WorkspaceRootKind): Promise<readonly string[]> {
  const found: string[] = [];
  for (const searched of SEARCHED) {
    if (existsSync(join(root, searched))) await walk(root, join(root, searched), kind, found);
  }
  return found.toSorted();
}
