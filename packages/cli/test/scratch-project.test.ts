import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { useScratchProject } from './support/scratch-project.ts';

const scratchParent = fileURLToPath(new URL('./.scratch', import.meta.url));

describe('the shared scratch parent', () => {
  const scratch = useScratchProject();

  test('a first test makes a project', async () => {
    expect(existsSync((await scratch()).root)).toBe(true);
  });

  test('the cleanup of the first test left the parent for the other test files', () => {
    expect(existsSync(scratchParent)).toBe(true);
  });

  test("a fork leaves git's lock files behind and copies the rest of the repository", async () => {
    const project = await scratch();
    await project.write({
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.git/index.lock': '',
      '.git/objects/maintenance.lock': '',
      'notes.lock': 'kept',
    });
    const copy = await project.fork();
    expect(existsSync(`${copy.root}/.git/HEAD`)).toBe(true);
    expect(existsSync(`${copy.root}/.git/index.lock`)).toBe(false);
    expect(existsSync(`${copy.root}/.git/objects/maintenance.lock`)).toBe(false);
    expect(existsSync(`${copy.root}/notes.lock`)).toBe(true);
  });
});
