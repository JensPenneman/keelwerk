import type { ProcessRun } from './process-run.ts';

/** Where and how `publishPackages` runs. */
export interface PublishOptions {
  readonly root: string;
  /** The directory pnpm packed into. */
  readonly tarballs: string;
  readonly dryRun: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly run: ProcessRun;
}
