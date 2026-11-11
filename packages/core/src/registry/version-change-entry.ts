import type { VersionChangeFixture, VersionTransforms } from '../api-versions/version-change.ts';

/** A version change a module declares (section 18.2). */
export interface VersionChangeEntry {
  /** '<module>.<key>': the id `LedgerEntry.changes` records; the key is the file name in camel case. */
  readonly id: string;
  readonly module: string;
  readonly key: string;
  readonly since: string;
  /** Entity values resolved to '<module>.<entity>'. */
  readonly surface: readonly {
    readonly entity?: string;
    readonly action?: string;
    readonly field?: string;
    readonly renamedFrom?: string;
    readonly addedRequired?: true;
    readonly removed?: true;
  }[];
  readonly input: VersionTransforms;
  readonly output: VersionTransforms;
  readonly errors: Readonly<Record<string, string>>;
  readonly fixtures: readonly VersionChangeFixture[];
}
