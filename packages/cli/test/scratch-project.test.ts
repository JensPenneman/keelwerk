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
});
