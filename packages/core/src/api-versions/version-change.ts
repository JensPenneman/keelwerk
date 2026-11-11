import type { SurfaceChangeSpec } from './surface-change-spec.ts';
import type { Translator } from './translator.ts';

/** Custom transforms, keyed by action reference. */
export type VersionTransforms = { readonly [actionRef: string]: Translator };

/** One recorded pair of an older and a newer value that a version change must translate between. */
export interface VersionChangeFixture {
  readonly ref: string;
  readonly older: unknown;
  readonly newer: unknown;
}

/** The literal of a version change (section 18.2). */
export interface VersionChange<B> {
  /** The module version that made the change. */
  readonly since: string;
  readonly surface: readonly SurfaceChangeSpec<B>[];
  readonly input?: VersionTransforms;
  readonly output?: VersionTransforms;
  /** Head code to older code. */
  readonly errors?: Readonly<Record<string, string>>;
  readonly fixtures?: readonly VersionChangeFixture[];
}
