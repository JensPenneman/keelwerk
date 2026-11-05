import type { ApiSurface, ExpectedLedgerEntry, SurfaceSource } from '@keelwerk/core';

/** An app of the workspace with everything the producers derive from it, once per run. */
export interface AppDerivation {
  /** The app root, absolute. */
  readonly directory: string;
  /** The app root relative to the workspace root. */
  readonly shown: string;
  readonly app: SurfaceSource;
  /** The exported type of the app in `src/app.ts` (`Library`). */
  readonly appType: string;
  /** The declared API versions, oldest first. */
  readonly dates: readonly string[];
  /** The surface at each declared version, in the order of `dates`. */
  readonly surfaces: readonly ApiSurface[];
  /** What the sources imply for the ledger, one entry per version. */
  readonly implied: readonly ExpectedLedgerEntry[];
}
