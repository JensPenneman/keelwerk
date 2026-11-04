import process, { argv, exit, stderr, stdout } from 'node:process';
import type { StricliProcess } from '@stricli/core';
import { exitCodeFor } from '../exit-code-for.ts';
import { createNodeHost } from '../host/create-node-host.ts';
import { runCli } from '../run-cli.ts';

async function main(): Promise<number> {
  const interrupt = new AbortController();
  const host = createNodeHost();
  const state: StricliProcess = { stdout, stderr, env: host.env };
  const onSignal = () => {
    if (interrupt.signal.aborted) {
      exit(exitCodeFor('interrupted'));
    }
    interrupt.abort();
  };
  process.on('SIGINT', onSignal);
  try {
    const code = await runCli(argv.slice(2), { host, process: state, signal: interrupt.signal });
    return interrupt.signal.aborted ? exitCodeFor('interrupted') : code;
  } finally {
    process.off('SIGINT', onSignal);
  }
}

// The binary's entry point: running it is the point of this file. The exit code is set, not
// exited with, so piped standard output drains before the process ends.
// biome-ignore lint/plugin: the bin file runs `main` when it is executed
process.exitCode = await main();
