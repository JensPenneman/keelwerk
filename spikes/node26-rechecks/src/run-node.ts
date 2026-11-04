import { spawnSync } from 'node:child_process';
import process from 'node:process';

// The child must be able to print warnings, or every "no warning" assertion would pass vacuously.
const childEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    // biome-ignore lint/style/noProcessEnv: the child inherits the parent environment minus the warning switches
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'NODE_NO_WARNINGS' && entry[0] !== 'NODE_OPTIONS',
    ),
  );

export interface NodeRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export const runNode = (args: readonly string[], cwd?: string): NodeRun => {
  const result = spawnSync(process.execPath, [...args], {
    cwd,
    encoding: 'utf8',
    env: childEnvironment(),
    timeout: 60_000,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};
