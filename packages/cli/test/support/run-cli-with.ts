import type { CliHost } from '../../src/context/cli-host.ts';
import { runCli } from '../../src/run-cli.ts';

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the CLI against a host with collected streams. */
export async function runCliWith(
  argv: readonly string[],
  host: CliHost,
  signal: AbortSignal = new AbortController().signal,
): Promise<CliRun> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    host,
    signal,
    process: {
      stdout: { write: (text: string) => out.push(text) > 0 },
      stderr: { write: (text: string) => err.push(text) > 0 },
      env: host.env,
    },
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}
