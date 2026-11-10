import { expect, test } from 'vitest';
import { publishRefusal } from '../publish-refusal.ts';

const allowed = {
  repository: 'JensPenneman/keelwerk',
  ref: 'refs/heads/main',
  version: '0.1.0',
  tagAtCommit: true,
  npmVersion: '11.21.1',
};

test('main of JensPenneman/keelwerk with the tag at the commit may stage', () => {
  expect(publishRefusal(allowed)).toBeUndefined();
});

test('a fork is refused', () => {
  expect(publishRefusal({ ...allowed, repository: 'someone/keelwerk' })).toBe(
    'refused: stages only in JensPenneman/keelwerk, not in someone/keelwerk',
  );
});

test.each(['refs/heads/scratch', 'refs/tags/v0.1.0', 'refs/pull/1/merge', undefined])(
  'the ref %s is refused',
  (ref) => {
    expect(publishRefusal({ ...allowed, ref })).toMatch(
      /^refused: stages only from refs\/heads\/main/,
    );
  },
);

test('a version without its tag at the commit is refused', () => {
  expect(publishRefusal({ ...allowed, tagAtCommit: false })).toBe(
    'refused: v0.1.0 does not point at this commit',
  );
});

test.each(['0.0.0', '1.0.0', '0.1'])('the version %s is refused', (version) => {
  expect(publishRefusal({ ...allowed, version })).toBe(
    `refused: ${version} is not a 0.x release (beta policy)`,
  );
});

test('npm older than 11.15.0 is refused', () => {
  expect(publishRefusal({ ...allowed, npmVersion: '11.14.9' })).toBe(
    'refused: npm 11.14.9 has no stage commands (11.15.0 or later)',
  );
  expect(publishRefusal({ ...allowed, npmVersion: '11.15.0' })).toBeUndefined();
  expect(publishRefusal({ ...allowed, npmVersion: '10.99.0' })).toMatch(/^refused: npm/);
});

test('an npm version that cannot be read refuses', () => {
  expect(publishRefusal({ ...allowed, npmVersion: 'npm warn x\n11.20.0' })).toMatch(
    /^refused: cannot read the npm version: npm warn x/,
  );
  expect(publishRefusal({ ...allowed, npmVersion: '' })).toBe(
    'refused: cannot read the npm version: no output',
  );
});
