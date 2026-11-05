import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ada, codeOf } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth } from './support/boot-auth.ts';

describe('concurrent sign-ups on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let auth: BootedAuth;

  beforeAll(async () => {
    postgres = await startPostgres();
    auth = await bootAuth('memory', {}, undefined, {
      factory: postgresAdapter({ ownerUrl: postgres.adminUrl }),
      url: postgres.appUrl,
    });
  }, 120_000);

  afterAll(async () => {
    await auth?.runtime.stop();
    await postgres?.stop();
  });

  test('two sign-ups of one identifier at once: exactly one succeeds, the other is auth.identifier_taken', async () => {
    const answers = await Promise.all(
      ['one password', 'two password'].map((password) =>
        auth.request('auth.signUp', { identifier: ada.identifier, password }),
      ),
    );
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok).map(codeOf)).toEqual(['auth.identifier_taken']);
  });

  test('the same holds when the spellings differ', async () => {
    const answers = await Promise.all(
      ['Grace@Example.org', 'grace@example.ORG'].map((identifier) =>
        auth.request('auth.signUp', { identifier, password: 'another long password' }),
      ),
    );
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(new Set(answers.filter((answer) => !answer.ok).map(codeOf))).toEqual(
      new Set(['auth.identifier_taken']),
    );
  });
});
