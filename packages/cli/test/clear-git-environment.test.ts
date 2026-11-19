import { execFile } from 'node:child_process';
import { env } from 'node:process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { clearGitEnvironment } from './support/clear-git-environment.ts';
import { initScratchRepository } from './support/init-scratch-repository.ts';
import { useScratchProject } from './support/scratch-project.ts';

const run = promisify(execFile);

const gitDirectory = (): unknown => Reflect.get(env, 'GIT_DIR');

describe('clearGitEnvironment', () => {
  const scratch = useScratchProject();

  test('a git process started with the inherited environment works on the repository of its directory', async () => {
    const other = await scratch();
    await initScratchRepository(other.root);
    const project = await scratch();
    await initScratchRepository(project.root);
    vi.stubEnv('GIT_DIR', `${other.root}/.git`);
    clearGitEnvironment();
    expect(gitDirectory()).toBeUndefined();
    const answer = await run('git', ['rev-parse', '--absolute-git-dir'], { cwd: project.root });
    expect(answer.stdout.trim()).toBe(`${project.root}/.git`);
  });

  describe('after the test', () => {
    const sentinel = '/nonexistent/clear-git-environment.git';
    let before: unknown;
    beforeAll(() => {
      before = Reflect.get(env, 'GIT_DIR');
      Reflect.set(env, 'GIT_DIR', sentinel);
    });
    afterAll(() => {
      if (before === undefined) Reflect.deleteProperty(env, 'GIT_DIR');
      else Reflect.set(env, 'GIT_DIR', before);
    });

    test('the variables are gone while the test runs', () => {
      clearGitEnvironment();
      expect(gitDirectory()).toBeUndefined();
    });

    test('the variables are back when the test has ended', () => {
      expect(gitDirectory()).toBe(sentinel);
    });
  });
});
