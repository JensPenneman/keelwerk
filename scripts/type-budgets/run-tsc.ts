import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Runs the repository's `tsc` and returns what it printed; a failing exit code is part of the output. */
export function runTsc(repo: string, args: readonly string[], cwd: string): string {
  try {
    return execFileSync(join(repo, 'node_modules', '.bin', 'tsc'), [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const failed = error as { readonly stdout?: string; readonly stderr?: string };
    return `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
  }
}
