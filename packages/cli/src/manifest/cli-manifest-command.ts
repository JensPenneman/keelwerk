import type { CliManifestFlag } from './cli-manifest-flag.ts';

/** One command under `call` in the CLI manifest: the route, the positionals and the flags of an action. */
export interface CliManifestCommand {
  readonly ref: string;
  readonly route: string;
  readonly aliases: readonly string[];
  readonly kind: string;
  readonly auth: string;
  readonly scope: string;
  readonly description?: string;
  readonly positionals: readonly CliManifestFlag[];
  readonly flags: readonly CliManifestFlag[];
}
