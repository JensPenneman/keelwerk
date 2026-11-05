import { testOperator, testPrincipal } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { type BootedAccounts, bootAccounts, type StorageKind } from './support/boot-accounts.ts';

const operator = testOperator();
const librarian = testPrincipal('librarian', { roles: ['directory'] });
const signedIn = testPrincipal('ada');
const anonymous = testPrincipal(null);

const settle = (call: Promise<unknown>): Promise<{ code?: string | undefined; value?: unknown }> =>
  call.then(
    (value) => ({ value }),
    (error: { code?: string }) => ({ code: error.code }),
  );

/** An operator creates a profile through the generated action. */
async function enrol(
  accounts: BootedAccounts,
  displayName: string,
  email: string,
  tenant: 'acme' | 'globex' = 'acme',
) {
  return accounts
    .client(operator, tenant)
    .invoke('accounts.profile.create', { displayName, email });
}

describe.each(['memory', 'pglite'] as const)('accounts alone on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(settings: { readonly allowSelfRegistration?: boolean } = {}) {
    const accounts = await bootAccounts(kind, settings);
    onTestFinished(() => accounts.runtime.stop());
    return accounts;
  }

  test('identities is empty while no login module is selected', { timeout }, async () => {
    const accounts = await boot();
    const { id } = await enrol(accounts, 'Ada', 'ada@example.org');
    const answer = await accounts.client(signedIn).invoke('accounts.identities', { profileId: id });
    expect(answer).toEqual({ providers: [] });
  });

  test('register is forbidden for everyone but an operator while self-registration is off', {
    timeout,
  }, async () => {
    const accounts = await boot();
    const input = { displayName: 'Ada', email: 'ada@example.org' };
    for (const caller of [anonymous, signedIn]) {
      const refused = await settle(accounts.client(caller).invoke('accounts.register', input));
      expect(refused.code).toBe('core.forbidden');
    }
    const done = await accounts.client(operator).invoke('accounts.register', input);
    const row = await accounts
      .client(operator)
      .invoke('accounts.profile.get', { ids: [done.profileId] });
    expect(row.list).toMatchObject([{ email: 'ada@example.org' }]);
  });

  test('register is public while self-registration is on', { timeout }, async () => {
    const accounts = await boot({ allowSelfRegistration: true });
    const done = await accounts
      .client(anonymous)
      .invoke('accounts.register', { displayName: 'Grace', email: 'grace@example.org' });
    expect(done.profileId).toEqual(expect.any(String));
    const row = await accounts
      .client(operator)
      .invoke('accounts.profile.get', { ids: [done.profileId] });
    expect(row.list).toMatchObject([{ displayName: 'Grace' }]);
  });

  test('a taken address is accounts.email_taken, whatever its case', { timeout }, async () => {
    const accounts = await boot({ allowSelfRegistration: true });
    await accounts
      .client(anonymous)
      .invoke('accounts.register', { displayName: 'Ada', email: 'ada@example.org' });
    const taken = await settle(
      accounts
        .client(anonymous)
        .invoke('accounts.register', { displayName: 'Other', email: 'ADA@Example.org' }),
    );
    expect(taken.code).toBe('accounts.email_taken');
  });

  test('two concurrent registrations of one address: one succeeds, one is email_taken', {
    timeout,
  }, async () => {
    const accounts = await boot({ allowSelfRegistration: true });
    const answers = await Promise.all(
      ['First', 'Second'].map((displayName) =>
        settle(
          accounts
            .client(anonymous)
            .invoke('accounts.register', { displayName, email: 'twin@example.org' }),
        ),
      ),
    );
    expect(answers.filter((answer) => answer.code === undefined)).toHaveLength(1);
    expect(answers.filter((answer) => answer.code === 'accounts.email_taken')).toHaveLength(1);
    const found = await accounts
      .client(operator)
      .invoke('accounts.profile.search', { text: 'twin@' });
    expect(found.items).toHaveLength(1);
  });

  test('the address is unique whatever its case, also between concurrent creations', {
    timeout,
  }, async () => {
    const accounts = await boot();
    await enrol(accounts, 'Ada', 'ada@example.org');
    const taken = await settle(enrol(accounts, 'Other', 'ADA@Example.org'));
    expect(taken.code).toBe('core.conflict');
    const answers = await Promise.all([
      settle(enrol(accounts, 'First', 'twin@example.org')),
      settle(enrol(accounts, 'Second', 'twin@example.org')),
    ]);
    expect(answers.filter((answer) => answer.code === undefined)).toHaveLength(1);
    expect(answers.filter((answer) => answer.code === 'core.conflict')).toHaveLength(1);
  });

  test('an operator searches by name prefix or address prefix, with three characters at least', {
    timeout,
  }, async () => {
    const accounts = await boot();
    await enrol(accounts, 'Ada Lovelace', 'ada@example.org');
    await enrol(accounts, 'Grace Hopper', 'grace@example.org');
    const admin = accounts.client(operator);
    const short = await settle(admin.invoke('accounts.profile.search', { text: 'ad' }));
    expect(short.code).toBe('core.validation');
    const byEmail = await admin.invoke('accounts.profile.search', { text: 'grace@' });
    expect(byEmail.items.map((row) => row.displayName)).toEqual(['Grace Hopper']);
    const byName = await admin.invoke('accounts.profile.search', { text: 'Ada L' });
    expect(byName.items.map((row) => row.displayName)).toEqual(['Ada Lovelace']);
    const inside = await admin.invoke('accounts.profile.search', { text: 'Lovelace' });
    expect(inside.items).toEqual([]);
  });

  test('the directory role searches by name prefix and never sees an address', {
    timeout,
  }, async () => {
    const accounts = await boot();
    const { id } = await enrol(accounts, 'Ada Lovelace', 'ada@example.org');
    await enrol(accounts, 'Grace Hopper', 'grace@example.org');
    const directory = accounts.client(librarian);
    const got = await directory.invoke('accounts.profile.get', { ids: [id] });
    expect(got.list[0]).toMatchObject({ displayName: 'Ada Lovelace' });
    expect(got.list[0]).not.toHaveProperty('email');
    const found = await directory.invoke('accounts.profile.search', { text: 'Ada' });
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({ displayName: 'Ada Lovelace' });
    expect(found.items[0]).not.toHaveProperty('email');
    const byAddress = await directory.invoke('accounts.profile.search', { text: 'grace@' });
    expect(byAddress.items).toEqual([]);
  });

  test('an active profile deactivates once, and the row stays readable but frozen', {
    timeout,
  }, async () => {
    const accounts = await boot();
    const admin = accounts.client(operator);
    const { id } = await enrol(accounts, 'Ada', 'ada@example.org');
    const done = await admin.invoke('accounts.profile.deactivate', { id, reason: 'left' });
    expect(done).toMatchObject({ id, displayName: 'Ada' });
    expect(done.deactivatedAt).toBeInstanceOf(Temporal.Instant);
    const again = await settle(admin.invoke('accounts.profile.deactivate', { id }));
    // the deny rule `frozen` tests the row before the action: a deactivated profile is not found for it
    expect(again.code).toBe('core.not_found');
    const got = await admin.invoke('accounts.profile.get', { ids: [id] });
    expect(got.list[0]).toMatchObject({ id, deactivatedAt: done.deactivatedAt });
    const edited = await settle(
      admin.invoke('accounts.profile.update', { id, patch: { displayName: 'Ada L.' } }),
    );
    expect(edited.code).toBe('core.not_found');
    const active = await enrol(accounts, 'Grace', 'grace@example.org');
    const patched = await admin.invoke('accounts.profile.update', {
      id: active.id,
      patch: { displayName: 'Grace H.' },
    });
    expect(patched).toMatchObject({ displayName: 'Grace H.' });
  });

  test('a tenant sees only its own profiles and may reuse an address', { timeout }, async () => {
    const accounts = await boot();
    const { id } = await enrol(accounts, 'Ada', 'ada@example.org');
    const other = accounts.client(operator, 'globex');
    const found = await other.invoke('accounts.profile.search', { text: 'ada' });
    expect(found.items).toEqual([]);
    const got = await settle(other.invoke('accounts.profile.get', { ids: [id] }));
    expect(got.code === undefined ? got.value : null).toMatchObject({ list: [] });
    const twin = await settle(enrol(accounts, 'Ada', 'ada@example.org', 'globex'));
    expect(twin.code).toBeUndefined();
  });
});
