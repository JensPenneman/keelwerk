import type { CliHost } from '../context/cli-host.ts';
import type { AppOptions } from './app-child.ts';
import type { AppProcess, AppReady } from './app-process.ts';
import { childCommand } from './child-command.ts';
import { devChildEnv } from './dev-child-env.ts';
import { formatLogLine } from './format-log-line.ts';
import { lineBuffer } from './line-buffer.ts';
import { readyMarker } from './ready-marker.ts';

/** Starts the app child (section 13.6); its log lines go to `print` as the terminal shows them. */
export function startApp(
  host: CliHost,
  options: AppOptions,
  print: (line: string) => void,
): AppProcess {
  const command = childCommand('app', options);
  let markReady: (ready: AppReady) => void = () => undefined;
  const readied = new Promise<AppReady>((resolve) => {
    markReady = resolve;
  });
  const out = lineBuffer((line) => {
    if (line.startsWith(readyMarker)) {
      const ready = JSON.parse(line.slice(readyMarker.length + 1)) as AppReady;
      markReady(ready);
      return;
    }
    const shown = formatLogLine(line);
    if (shown !== undefined) print(shown);
  });
  const err = lineBuffer((line) => print(line));
  const child = host.spawn(command.command, command.args, {
    cwd: options.root,
    env: devChildEnv(host.env),
    onStdout: out.push,
    onStderr: err.push,
  });
  const exited = child.exited.then((exit) => {
    out.flush();
    err.flush();
    return exit;
  });
  return {
    ready: Promise.race([readied, exited]),
    exited,
    stop: async (deadlineMs) => {
      child.kill('SIGTERM');
      let cancel: (() => void) | undefined;
      const late = new Promise<'late'>((resolve) => {
        cancel = host.schedule(deadlineMs, () => resolve('late'));
      });
      if ((await Promise.race([exited, late])) === 'late') child.kill('SIGKILL');
      cancel?.();
      await exited;
    },
  };
}
