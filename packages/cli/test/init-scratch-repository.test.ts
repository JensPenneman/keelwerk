import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, test, vi } from 'vitest';
import { initScratchRepository } from './support/init-scratch-repository.ts';
import { scratchGitEnvironment } from './support/scratch-git-environment.ts';
import { useScratchProject } from './support/scratch-project.ts';

const run = promisify(execFile);

describe('initScratchRepository', () => {
  const scratch = useScratchProject();

  test('a repository made by the helper reports automatic maintenance and automatic gc off', async () => {
    const project = await scratch();
    const git = await initScratchRepository(project.root);
    expect((await git('config', '--local', '--get', 'maintenance.auto')).stdout).toBe('false\n');
    expect((await git('config', '--local', '--get', 'gc.auto')).stdout).toBe('0\n');
  });

  test('a commit in a repository made by the helper starts no background maintenance', async () => {
    const project = await scratch();
    const git = await initScratchRepository(project.root);
    await git('add', '--all');
    const commit = await run('git', ['commit', '--quiet', '-m', 'base'], {
      cwd: project.root,
      // biome-ignore lint/style/useNamingConvention: the name is git's environment variable
      env: { ...scratchGitEnvironment(), GIT_TRACE: '1' },
    });
    expect(commit.stderr).not.toContain('maintenance run');
    expect(commit.stderr).not.toContain('gc --auto');
  });

  test('a repository made by the helper ignores GIT_DIR and leaves the repository it points to alone', async () => {
    const other = await scratch();
    const otherGit = await initScratchRepository(other.root);
    await otherGit('config', '--local', '--unset', 'user.name');
    const project = await scratch();
    vi.stubEnv('GIT_DIR', `${other.root}/.git`);
    try {
      await initScratchRepository(project.root);
    } finally {
      vi.unstubAllEnvs();
    }
    await expect(access(`${project.root}/.git`)).resolves.toBeUndefined();
    await expect(otherGit('config', '--local', '--get', 'user.name')).rejects.toThrow();
  });
});
