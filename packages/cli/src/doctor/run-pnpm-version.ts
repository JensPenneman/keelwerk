import type { CliHost } from '../context/cli-host.ts';

/** How long pnpm may take to print its version. */
const limitMilliseconds = 15_000;

/** Asks the host for the pnpm on its path; undefined when there is none, when it fails or when it is too slow. */
export async function runPnpmVersion(
  host: Pick<CliHost, 'spawn' | 'schedule' | 'env'>,
): Promise<string | undefined> {
  let output = '';
  const child = host.spawn('pnpm', ['--version'], {
    env: host.env,
    onStdout: (text) => {
      output += text;
    },
  });
  const cancel = host.schedule(limitMilliseconds, () => child.kill('SIGKILL'));
  const exit = await child.exited;
  cancel();
  return exit.code === 0 ? output.trim() : undefined;
}
