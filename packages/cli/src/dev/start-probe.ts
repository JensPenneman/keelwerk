import type { CliHost } from '../context/cli-host.ts';
import { childCommand } from './child-command.ts';
import { eventMarker } from './event-marker.ts';
import { nameHangingImport } from './name-hanging-import.ts';
import type { ProbeOptions } from './probe-child.ts';
import { probeLimitMs } from './probe-limit.ts';
import type { ProbeOutcome } from './probe-outcome.ts';
import type { ProbeResult } from './probe-result.ts';
import { resultMarker } from './result-marker.ts';
import { runChild } from './run-child.ts';

function shown(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => !line.startsWith(eventMarker))
    .join('\n')
    .trim();
}

function resultOf(stdout: string): ProbeResult | undefined {
  const line = stdout.split('\n').findLast((candidate) => candidate.startsWith(resultMarker));
  return line === undefined
    ? undefined
    : (JSON.parse(line.slice(resultMarker.length + 1)) as ProbeResult);
}

/** Runs the probe of section 13.6 in a fresh child, with its limit; a probe that hangs is killed and the import it waits on is named. */
export async function startProbe(
  host: CliHost,
  options: ProbeOptions,
  limitMs: number = probeLimitMs,
): Promise<ProbeOutcome> {
  const run = await runChild(host, childCommand('probe', options), {
    cwd: options.root,
    env: host.env,
    limitMs,
  });
  if (run.exit === 'timeout') {
    const hanging = nameHangingImport(run.stderr);
    const where =
      hanging === undefined ? 'while it composed the apps' : `while it evaluated ${hanging}`;
    return {
      kind: 'failed',
      message: `the probe did not finish within ${limitMs / 1000} seconds, ${where}; module definitions must be free of I/O at import time`,
    };
  }
  const result = resultOf(run.stdout);
  if (run.exit.code !== 0 || result === undefined) {
    const detail = shown(run.stderr);
    return { kind: 'failed', message: detail === '' ? 'the probe failed without output' : detail };
  }
  return { kind: 'done', result };
}
