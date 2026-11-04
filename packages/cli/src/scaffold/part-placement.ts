import { camelFromKebab } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import { relativeImport } from './relative-import.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

function scopeDirectory(request: ScaffoldRequest): { dir: string; file: string } | undefined {
  const { from, when } = request.options;
  if (from !== undefined) {
    const suffix = when.map((id) => `-when-${id}`).join('');
    return { dir: `contributions/to-${request.target}${suffix}`, file: 'contribution.ts' };
  }
  if (when.length > 0) {
    return { dir: `conditional/when-${when.join('-and-')}`, file: 'condition.ts' };
  }
  return undefined;
}

/** Where a part file goes and how it names its base. */
export interface PartPlacement {
  /** The file relative to the working directory. */
  readonly path: string;
  /** The file relative to the package root's `src/`. */
  readonly inSource: string;
  /** The expression for the part's first argument: `libraryBase` or `within(libraryBase, toAccounts)`. */
  readonly source: string;
  /** Whether the part sits in a contribution or conditional part, so `within` and the declaration are imported. */
  readonly scoped: boolean;
  readonly baseName: string;
  readonly baseFrom: string;
  readonly declaration: { readonly name: string; readonly from: string } | undefined;
  /** The key of the declaration in the base (`toAccounts`), when scoped. */
  readonly scopeKey: string | undefined;
  /** The contribution or conditional directory below `src/` (`conditional/when-accounts`), when scoped. */
  readonly scopeDir: string | undefined;
}

/**
 * The path of a part below `directory` (`actions`, `policies`, ...), inside the contribution or
 * conditional part the flags name: `--from <module>` puts it in `contributions/to-<target>/`,
 * `--when <ids>` in `conditional/when-<ids>/` (section 23.14).
 */
export function partPlacement(
  request: ScaffoldRequest,
  directory: string,
  owner: string | undefined,
  fileName: string,
): PartPlacement {
  const scope = scopeDirectory(request);
  const folders = [scope?.dir, directory, owner].filter((part) => part !== undefined);
  const inSource = [...folders, `${fileName}.ts`].join('/');
  const path = `${request.root}/src/${inSource}`;
  const baseName = `${camelFromKebab(request.host)}Base`;
  const baseFrom = relativeImport(inSource, 'base.ts');
  if (scope === undefined) {
    return {
      path,
      inSource,
      source: baseName,
      scoped: false,
      baseName,
      baseFrom,
      declaration: undefined,
      scopeKey: undefined,
      scopeDir: undefined,
    };
  }
  if (!request.files.has(`${scope.dir}/${scope.file}`)) {
    const kind = scope.file === 'contribution.ts' ? 'contribution' : 'condition';
    const name = scope.dir.split('/')[1] ?? scope.dir;
    throw usageFailure(
      `src/${scope.dir}/${scope.file} does not exist: run "keelwerk new ${kind} ${request.host}.${name}" first.`,
    );
  }
  const key = camelFromKebab(scope.dir.split('/')[1] ?? scope.dir);
  return {
    path,
    inSource,
    source: `within(${baseName}, ${key})`,
    scoped: true,
    baseName,
    baseFrom,
    declaration: { name: key, from: relativeImport(inSource, `${scope.dir}/${scope.file}`) },
    scopeKey: key,
    scopeDir: scope.dir,
  };
}
