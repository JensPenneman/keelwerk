import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function packageName(directory: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'name' in parsed) {
      return typeof parsed.name === 'string' ? parsed.name : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function scopeOf(name: string | undefined): string | undefined {
  return name?.startsWith('@') && name.includes('/') ? name.slice(0, name.indexOf('/')) : undefined;
}

function siblingScope(cwd: string): string | undefined {
  for (const parent of ['packages', 'modules']) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(cwd, parent)).toSorted();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const scope = scopeOf(packageName(join(cwd, parent, entry)));
      if (scope !== undefined) {
        return scope;
      }
    }
  }
  return undefined;
}

/** What the scaffolds read of the workspace around the working directory. */
export interface WorkspaceFacts {
  /** The package scope of the project (`@keelwerk`); absent when nothing in the workspace names one. */
  readonly scope: string | undefined;
  /** The framework's own core package sits at `packages/core`, so a module references it. */
  readonly coreSibling: boolean;
  /** Modules live in `packages/module-<id>` (a framework or shared repository), not `modules/<id>`. */
  readonly packagesLayout: boolean;
}

/**
 * The scope comes from `--scope`, else from the package the scaffold lands in (`existing`), else
 * from the root `package.json`, else from the first scoped package below `packages/` or
 * `modules/`; only a scoped name counts, so an unscoped root name is never turned into one. A new module goes to `modules/`
 * unless the workspace has `packages/` and no `modules/` or `apps/`.
 */
export function workspaceFacts(
  cwd: string,
  override: string | undefined,
  existing: string | undefined,
): WorkspaceFacts {
  const scope =
    override ??
    scopeOf(existing === undefined ? undefined : packageName(join(cwd, existing))) ??
    scopeOf(packageName(cwd)) ??
    siblingScope(cwd);
  return {
    scope,
    coreSibling: existsSync(join(cwd, 'packages', 'core', 'package.json')),
    packagesLayout:
      existing === undefined
        ? existsSync(join(cwd, 'packages')) &&
          !existsSync(join(cwd, 'modules')) &&
          !existsSync(join(cwd, 'apps'))
        : existing.startsWith('packages/'),
  };
}
