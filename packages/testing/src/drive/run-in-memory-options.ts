import type { TestPrincipal } from '../harness/test-principal.ts';

/** What `runInMemory` runs a command with. */
export interface RunInMemoryOptions {
  readonly input: unknown;
  /** Rows to start from, the fields of each by entity reference; `id` may be named. */
  readonly rows?: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /** Default: user `tester`. */
  readonly principal?: TestPrincipal;
  /** The tenant's name; default: the first. */
  readonly tenant?: string;
  readonly commandId?: string;
}
