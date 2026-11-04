import type { ApiSurface } from '@keelwerk/core';
import type { CommandContext, StricliProcess } from '@stricli/core';
import type { OutputWriter } from '../output/output-writer.ts';
import type { UntypedClient } from '../untyped-client.ts';
import type { CliHost } from './cli-host.ts';
import type { ResolvedProfile } from './resolved-profile.ts';

/**
 * What every command receives (section 16.9.10). Injected, so command tests never touch process
 * globals: the machine is `host`, the streams are `process`.
 */
export interface CliContext extends CommandContext {
  readonly process: StricliProcess;
  readonly surface: ApiSurface;
  /** The app's client keyed by runtime strings. */
  readonly client: UntypedClient;
  /** Text, table, json, yaml and ndjson. */
  readonly output: OutputWriter;
  readonly profile: ResolvedProfile;
  readonly signal: AbortSignal;
  readonly host: CliHost;
}
