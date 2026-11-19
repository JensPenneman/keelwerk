import { env } from 'node:process';
import { onTestFinished, vi } from 'vitest';

/**
 * Removes every GIT_* variable from the environment of the running test, so a git process the product starts
 * works on the repository of its working directory. The variables come back when the test ends, also when it fails.
 */
export function clearGitEnvironment(): void {
  for (const name of Object.keys(env)) {
    if (name.startsWith('GIT_')) vi.stubEnv(name, undefined);
  }
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}
