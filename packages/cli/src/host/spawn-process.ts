import { spawn } from 'node:child_process';
import type { HostExit, HostProcess, HostSpawnOptions } from '../context/cli-host.ts';

/** The code a child that could not be started reports, as a shell does for a missing command. */
const notStarted = 127;

/** Starts `command` with piped output; the child ends with its code, or with 127 when it cannot start. */
export function spawnProcess(
  command: string,
  args: readonly string[],
  options: HostSpawnOptions,
): HostProcess {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env as NodeJS.ProcessEnv }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text: string) => options.onStdout?.(text));
  child.stderr.on('data', (text: string) => options.onStderr?.(text));
  const exited = new Promise<HostExit>((resolve) => {
    child.once('error', (error) => {
      options.onStderr?.(`${error.message}\n`);
      resolve({ code: notStarted, signal: null });
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return {
    exited,
    kill: (signal = 'SIGTERM') => {
      child.kill(signal);
    },
  };
}
