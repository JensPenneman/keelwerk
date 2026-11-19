import { env } from 'node:process';

/** The test process environment without the variables that make git work on another repository (GIT_DIR and the like). */
export function scratchGitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')));
}
