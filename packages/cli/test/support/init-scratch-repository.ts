import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scratchGitEnvironment } from './scratch-git-environment.ts';

const run = promisify(execFile);

/** Runs git with `args` in one scratch repository; answers git's output once git has exited, rejects when git fails. */
export type ScratchGit = (
  ...args: string[]
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

/**
 * Makes `root` a git repository in which no git command starts background work, and answers a runner for it.
 * The settings go to the repository's own config, so a copy of the project keeps them.
 */
export async function initScratchRepository(root: string): Promise<ScratchGit> {
  const git: ScratchGit = (...args) =>
    run('git', args, { cwd: root, env: scratchGitEnvironment() });
  await git('init', '--quiet');
  await git('config', '--local', 'maintenance.auto', 'false');
  await git('config', '--local', 'gc.auto', '0');
  await git('config', '--local', 'commit.gpgsign', 'false');
  await git('config', '--local', 'user.name', 't');
  await git('config', '--local', 'user.email', 't@example.com');
  return git;
}
