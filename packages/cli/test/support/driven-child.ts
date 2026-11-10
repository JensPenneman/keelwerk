import type { CliHost, HostExit } from '../../src/context/cli-host.ts';

/** A child the test drives by hand: what it prints, when it ends, and whether it was killed. */
export function drivenChild(): {
  readonly spawn: CliHost['spawn'];
  readonly killed: string[];
  stdout(text: string): void;
  stderr(text: string): void;
  end(exit: HostExit): void;
} {
  const killed: string[] = [];
  let out: (text: string) => void = () => undefined;
  let err: (text: string) => void = () => undefined;
  let end: (value: HostExit) => void = () => undefined;
  return {
    killed,
    stdout: (text) => out(text),
    stderr: (text) => err(text),
    end: (exit) => end(exit),
    spawn: (_command, _args, spawnOptions) => {
      out = spawnOptions.onStdout ?? out;
      err = spawnOptions.onStderr ?? err;
      const exited = new Promise<HostExit>((resolve) => {
        end = resolve;
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
