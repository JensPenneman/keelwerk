import { defineApp } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { apiKeys } from '@keelwerk/module-api-keys';
import { auth } from '@keelwerk/module-auth';
import { describe, expect, test } from 'vitest';
import { localApp } from './support/local-app.ts';

describe('the modules the portal ships (14.7.5)', () => {
  test('compose without the warning that a data-subject lookup has no index', () => {
    const unindexed = localApp.registry.problems.filter(
      (problem) => problem.code === 'dataSubjectUnindexed',
    );
    expect(unindexed).toEqual([]);
    // The control: the entities the check looks at are there.
    const subjects = [...localApp.registry.entities.values()]
      .filter((entry) => entry.descriptor.dataSubject !== null)
      .map((entry) => entry.ref);
    expect(subjects).toEqual(
      expect.arrayContaining([
        'auth.credential',
        'auth.session',
        'auth.resetToken',
        'accounts.profile',
      ]),
    );
  });
});

describe('every module the framework ships that owns rows of a subject: accounts, auth and API keys (D22)', () => {
  const shipped = defineApp({
    id: 'shipped',
    modules: [accounts, auth, apiKeys] as const,
  });

  test('compose without the warning that a data-subject lookup has no index, API keys included', () => {
    expect(
      shipped.registry.problems.filter((problem) => problem.code === 'dataSubjectUnindexed'),
    ).toEqual([]);
    // The control: the check looks at the key entity of the API keys module, which owns rows of a subject.
    const subjects = [...shipped.registry.entities.values()]
      .filter((entry) => entry.descriptor.dataSubject !== null)
      .map((entry) => entry.ref);
    expect(subjects).toEqual(expect.arrayContaining(['api-keys.key', 'auth.session']));
  });
});
