import type { CliHost } from '../context/cli-host.ts';
import type { ChildCommand } from './child-command.ts';
import type { ChildRun } from './child-run.ts';
import { eventMarker } from './event-marker.ts';
import { lineBuffer } from './line-buffer.ts';

/** Where a child runs and for how long it may go without progress. */
export interface RunChildOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The longest the child may go without printing an event line (see `eventMarker`), before its first one. */
  readonly limitMs: number;
  /** The limit that applies after the event line it is given; every event line restarts the timer with it. */
  readonly limitAfter: (line: string) => number;
  /** Called the moment the limit fires, with what the child had printed on standard error until then; output that arrives before the child is gone is not included. */
  readonly onTimeout?: (stderr: string) => void;
}

/**
 * Runs the child to its end, or kills it when it printed no event line within its limit: the limit
 * starts when the child starts and again with every event line, so a child that keeps reporting
 * progress is never stopped for the total time it needs.
 */
export async function runChild(
  host: CliHost,
  command: ChildCommand,
  options: RunChildOptions,
): Promise<ChildRun> {
  let stdout = '';
  let stderr = '';
  let over = false;
  let resolveTimeout: (value: 'timeout') => void = () => undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    resolveTimeout = resolve;
  });
  let cancel: () => void = () => undefined;
  const restart = (limitMs: number): void => {
    cancel();
    if (!over)
      cancel = host.schedule(limitMs, () => {
        options.onTimeout?.(stderr);
        resolveTimeout('timeout');
      });
  };
  const events = lineBuffer((line) => {
    if (line.startsWith(eventMarker)) restart(options.limitAfter(line));
  });
  restart(options.limitMs);
  try {
    const child = host.spawn(command.command, command.args, {
      cwd: options.cwd,
      env: options.env,
      onStdout: (text) => {
        stdout += text;
      },
      onStderr: (text) => {
        stderr += text;
        events.push(text);
      },
    });
    const first = await Promise.race([child.exited, timeout]);
    over = true;
    cancel();
    if (first === 'timeout') {
      child.kill('SIGKILL');
      await child.exited;
    }
    return { exit: first, stdout, stderr };
  } finally {
    // Also when the spawn throws: no timer may outlive the run.
    over = true;
    cancel();
  }
}
