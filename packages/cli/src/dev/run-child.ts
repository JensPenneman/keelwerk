import type { CliHost } from '../context/cli-host.ts';
import type { ChildCommand } from './child-command.ts';
import type { ChildRun } from './child-run.ts';

/** Where a child runs and for how long. */
export interface RunChildOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly limitMs: number;
}

/** Runs the child to its end, or kills it when `limitMs` has passed. */
export async function runChild(
  host: CliHost,
  command: ChildCommand,
  options: RunChildOptions,
): Promise<ChildRun> {
  let stdout = '';
  let stderr = '';
  const child = host.spawn(command.command, command.args, {
    cwd: options.cwd,
    env: options.env,
    onStdout: (text) => {
      stdout += text;
    },
    onStderr: (text) => {
      stderr += text;
    },
  });
  let cancel: (() => void) | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    cancel = host.schedule(options.limitMs, () => resolve('timeout'));
  });
  const first = await Promise.race([child.exited, timeout]);
  cancel?.();
  if (first === 'timeout') {
    child.kill('SIGKILL');
    await child.exited;
  }
  return { exit: first, stdout, stderr };
}
