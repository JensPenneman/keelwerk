import type { CliHost, HostExit, HostSpawnOptions } from '../../src/context/cli-host.ts';

/** A spawn whose child writes `stdout` and `stderr`, then ends with `exit`; or never ends when `exit` is undefined. */
export function spawningChild(
  stdout: string,
  stderr: string,
  exit: HostExit | undefined,
): {
  readonly spawn: CliHost['spawn'];
  readonly killed: string[];
} {
  const killed: string[] = [];
  return {
    killed,
    spawn: (_command: string, _args: readonly string[], spawnOptions: HostSpawnOptions) => {
      spawnOptions.onStdout?.(stdout);
      spawnOptions.onStderr?.(stderr);
      let end: (value: HostExit) => void = () => undefined;
      const exited = new Promise<HostExit>((resolve) => {
        end = resolve;
        if (exit !== undefined) resolve(exit);
      });
      return {
        exited,
        kill: (signal = 'SIGTERM') => {
          killed.push(signal);
          end({ code: null, signal });
        },
      };
    },
  };
}
