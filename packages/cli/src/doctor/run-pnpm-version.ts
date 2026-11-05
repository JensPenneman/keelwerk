import { execFile } from 'node:child_process';

/** Asks the machine for the pnpm on its path; undefined when there is none. */
export function runPnpmVersion(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('pnpm', ['--version'], { timeout: 15_000 }, (error, stdout) => {
      resolve(error === null ? stdout.trim() : undefined);
    });
  });
}
