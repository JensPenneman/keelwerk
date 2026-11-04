import type { NewKind } from './new-kind.ts';
import type { ScaffoldOptions } from './scaffold-options.ts';

/** Everything a template needs; templates are pure functions of it. */
export interface ScaffoldRequest {
  readonly kind: NewKind;
  /** The module (or app, or script) id the reference starts with. */
  readonly target: string;
  /** The module whose package receives the files: `--from`, else `target`. */
  readonly host: string;
  /** The reference after the module id, kebab-case. */
  readonly names: readonly string[];
  /** The package root relative to the working directory, `/` separators. */
  readonly root: string;
  /** The package scope (`@keelwerk`) used for imports of other modules; read it through `requireScope`. */
  readonly scope: string | undefined;
  /** Whether the workspace holds the framework's own core package (`../core` is a sibling). */
  readonly coreSibling: boolean;
  /** `module-<id>` below `packages/`, else the id: how sibling module directories are named. */
  readonly packagesLayout: boolean;
  /** The files of the host module's `src/`, relative to `src/`, `/` separators. */
  readonly files: ReadonlySet<string>;
  readonly options: ScaffoldOptions;
}
