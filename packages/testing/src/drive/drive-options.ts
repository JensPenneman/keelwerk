import type { TestPrincipal } from '../harness/test-principal.ts';

/** What `drive` runs a command's `decide` with. */
export interface DriveOptions {
  /** The command's input, as `decide` receives it. */
  readonly input: unknown;
  /** The configuration of the command's module (section 3.4). */
  readonly config?: unknown;
  /** Default: user `tester`. */
  readonly principal?: TestPrincipal;
  /** Entity commands: the row the command is mounted on, as loaded. */
  readonly target?: Readonly<Record<string, unknown>>;
  /** The invocation's instant; default: 2026-01-01T00:00:00Z. */
  readonly now?: Temporal.Instant;
}
