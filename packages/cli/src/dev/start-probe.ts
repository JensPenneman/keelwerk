import type { CliHost } from '../context/cli-host.ts';
import { childCommand } from './child-command.ts';
import { eventMarker } from './event-marker.ts';
import { lastStepOf } from './last-step-of.ts';
import { nameHangingImport } from './name-hanging-import.ts';
import type { ProbeOptions } from './probe-child.ts';
import { probeLimitMs } from './probe-limit.ts';
import type { ProbeOutcome } from './probe-outcome.ts';
import type { ProbeResult } from './probe-result.ts';
import { probeStepLimitMs } from './probe-step-limit.ts';
import { resultMarker } from './result-marker.ts';
import { runChild } from './run-child.ts';
import { watchProbeLimit } from './watch-probe-limit.ts';

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

/**
 * Runs the probe of section 13.6 in a fresh child. The limit is the longest the probe may go
 * without progress, not its total time, and which one applies depends on what the probe is doing:
 * `importLimitMs` while a project module import is in flight (a definition file that stays silent
 * that long does I/O at import time), `stepLimitMs` while none is (the probe's own work, where
 * silence means a slow machine or database). Every import, every evaluated module and every
 * finished step restarts it. A probe that stalls is killed and the import it waits on, or the
 * step it finished last, is named.
 */
export async function startProbe(
  host: CliHost,
  options: ProbeOptions,
  importLimitMs: number = probeLimitMs,
  stepLimitMs: number = probeStepLimitMs,
): Promise<ProbeOutcome> {
  const watch = watchProbeLimit(importLimitMs, stepLimitMs);
  // What the fired timer was armed for, taken when it fires: stderr that arrives before the child is gone must not change the message.
  const fired: { importing: boolean; stderr: string }[] = [];
  const run = await runChild(host, childCommand('probe', options), {
    cwd: options.root,
    env: host.env,
    limitMs: watch.startMs,
    limitAfter: watch.after,
    onTimeout: (stderr) => {
      fired.push({ importing: watch.importing(), stderr });
    },
  });
  if (run.exit === 'timeout') {
    const stalled = fired[0] ?? { importing: false, stderr: run.stderr };
    if (stalled.importing) {
      const hanging = nameHangingImport(stalled.stderr);
      const where = hanging === undefined ? 'its modules' : hanging;
      return {
        kind: 'failed',
        message: `the probe made no progress for ${importLimitMs / 1000} seconds, while it evaluated ${where}; module definitions must be free of I/O at import time`,
      };
    }
    const step = lastStepOf(stalled.stderr);
    return {
      kind: 'failed',
      message: `the probe made no progress for ${stepLimitMs / 1000} seconds, ${step === undefined ? 'before it reported a step' : `after it ${step}`}`,
    };
  }
  const result = resultOf(run.stdout);
  if (run.exit.code !== 0 || result === undefined) {
    const detail = shown(run.stderr);
    return { kind: 'failed', message: detail === '' ? 'the probe failed without output' : detail };
  }
  return { kind: 'done', result };
}
