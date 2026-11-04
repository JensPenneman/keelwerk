import type { StricliProcess } from '@stricli/core';
import type { CliHost } from './context/cli-host.ts';

/** What one run of the CLI is given: the machine, the streams and exit code slot, and the interrupt signal. */
export interface CliIo {
  readonly host: CliHost;
  readonly process: StricliProcess;
  readonly signal: AbortSignal;
}
