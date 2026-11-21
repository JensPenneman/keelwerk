import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { testPrincipal } from '@keelwerk/testing';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type BootedAccounts, bootAccounts } from './support/boot-accounts.ts';

const settle = (call: Promise<unknown>): Promise<{ code?: string | undefined; value?: unknown }> =>
  call.then(
    (value) => ({ value }),
    (error: { code?: string }) => ({ code: error.code }),
  );

describe('concurrent registrations on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let accounts: BootedAccounts;

  beforeAll(async () => {
    postgres = await startPostgres();
    accounts = await bootAccounts(
      'memory',
      { allowSelfRegistration: true },
      {
        factory: postgresAdapter({ ownerUrl: postgres.adminUrl }),
        url: postgres.appUrl,
      },
    );
  }, 120_000);

  afterAll(async () => {
    await accounts?.runtime.stop();
    await postgres?.stop();
  });

  test('two registrations of one e-mail at once: exactly one succeeds, the other is accounts.email_taken', async () => {
    const caller = accounts.client(testPrincipal('ada'));
    const answers = await Promise.all(
      ['Ada', 'Ada again'].map((displayName) =>
        settle(caller.invoke('accounts.register', { displayName, email: 'ada@example.org' })),
      ),
    );
    expect(answers.filter((answer) => answer.code === undefined)).toHaveLength(1);
    expect(answers.flatMap((answer) => (answer.code === undefined ? [] : [answer.code]))).toEqual([
      'accounts.email_taken',
    ]);
  });
});
