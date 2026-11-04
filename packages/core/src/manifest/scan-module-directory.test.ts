import { describe, expect, test } from 'vitest';
import { scanModuleDirectory } from './scan-module-directory.ts';

describe('scanModuleDirectory', () => {
  test('places an action, an entity action and a rule by their paths', () => {
    const { parts, unplaced } = scanModuleDirectory([
      'actions/login.ts',
      'actions/credential/revoke.ts',
      'policies/credential/self.ts',
      'policies/public-actions.ts',
    ]);
    expect(unplaced).toEqual([]);
    expect(parts.map(({ section, owner, key }) => [section, owner, key])).toEqual([
      ['entityActions', 'credential', 'revoke'],
      ['actions', undefined, 'login'],
      ['policies', 'credential', 'self'],
      ['policies', undefined, 'publicActions'],
    ]);
  });

  test('reads a contribution and a conditional directory under the declaration key', () => {
    const { parts } = scanModuleDirectory([
      'contributions/to-accounts/contribution.ts',
      'contributions/to-accounts/actions/profile/change-password.ts',
      'conditional/when-accounts/condition.ts',
      'conditional/when-accounts/reactions/revoke-on-deactivation.ts',
    ]);
    expect(
      parts.map(({ scope, section, key }) => [scope?.section, scope?.key, section, key]),
    ).toEqual([
      ['conditional', 'whenAccounts', 'reactions', 'revokeOnDeactivation'],
      ['contributes', 'toAccounts', 'entityActions', 'changePassword'],
    ]);
  });

  test('ignores declarations, libraries, tests and non-source files', () => {
    const { parts, unplaced } = scanModuleDirectory([
      'base.ts',
      'config.ts',
      'module.generated.ts',
      'module.test-d.ts',
      'entities/session.ts',
      'errors/invalid-credentials.ts',
      'lib/add-minutes.ts',
      'actions/login.test.ts',
      'executors/lib/http.ts',
      'README.md',
    ]);
    expect(parts).toEqual([]);
    expect(unplaced).toEqual([]);
  });

  test('reports a file the conventions cannot place instead of mounting it', () => {
    const { parts, unplaced } = scanModuleDirectory([
      'misc/thing.ts',
      'actions/Login.ts',
      'actions/a/b/c.ts',
      'services/x/y.ts',
      'contributions/to-accounts/stray.ts',
      'stray.ts',
    ]);
    expect(parts).toEqual([]);
    expect(unplaced.map(({ path }) => path)).toEqual([
      'actions/Login.ts',
      'actions/a/b/c.ts',
      'contributions/to-accounts/stray.ts',
      'misc/thing.ts',
      'services/x/y.ts',
      'stray.ts',
    ]);
  });

  test('refuses a rule that shares its name with a policy target', () => {
    const { parts, unplaced } = scanModuleDirectory([
      'policies/book.ts',
      'policies/book/readers.ts',
    ]);
    expect(parts.map(({ key }) => key)).toEqual(['book']);
    expect(unplaced.map(({ path }) => path)).toEqual(['policies/book/readers.ts']);
  });
});
