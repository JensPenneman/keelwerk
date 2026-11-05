import { testPrincipal } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { type BootedAccounts, bootAccounts, type StorageKind } from './support/boot-accounts.ts';

const operator = testPrincipal('operator', { claims: { operator: true } });
const librarian = testPrincipal('librarian', { roles: ['directory'] });
const signedIn = testPrincipal('ada');

const settle = (call: Promise<unknown>): Promise<{ code?: string | undefined; value?: unknown }> =>
  call.then(
    (value) => ({ value }),
    (error: { code?: string }) => ({ code: error.code }),
  );

/** The generated update takes the changed fields beside `id`; the client types it as a `patch` member. */
const flatUpdate = (input: Record<string, unknown>): never => input as never;

/** An operator creates a profile through the generated action; registration is the public way in. */
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

  test('identities is empty while no login module is selected', { timeout }, async () => {
    const accounts = await bootAccounts(kind);
    onTestFinished(() => accounts.runtime.stop(0));
    const { id } = await enrol(accounts, 'Ada', 'ada@example.org');
    const answer = await accounts.client(signedIn).invoke('accounts.identities', { profileId: id });
    expect(answer).toEqual({ providers: [] });
  });

  test('the address is unique whatever its case, also between concurrent creations', {
    timeout,
  }, async () => {
    const accounts = await bootAccounts(kind);
    onTestFinished(() => accounts.runtime.stop(0));
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

  test('search needs three characters and matches the email prefix', { timeout }, async () => {
    const accounts = await bootAccounts(kind);
    onTestFinished(() => accounts.runtime.stop(0));
    await enrol(accounts, 'Ada Lovelace', 'ada@example.org');
    await enrol(accounts, 'Grace Hopper', 'grace@example.org');
    const admin = accounts.client(operator);
    const short = await settle(admin.invoke('accounts.profile.search', { text: 'ad' }));
    expect(short.code).toBe('core.validation');
    const byEmail = await admin.invoke('accounts.profile.search', { text: 'grace@' });
    expect(byEmail.items.map((row) => row.displayName)).toEqual(['Grace Hopper']);
    const byName = await admin.invoke('accounts.profile.search', { text: 'Lovelace' });
    expect(byName.items.map((row) => row.displayName)).toEqual(['Ada Lovelace']);
  });

  test('the directory role reads profiles without their addresses and cannot filter by them', {
    timeout,
  }, async () => {
    const accounts = await bootAccounts(kind);
    onTestFinished(() => accounts.runtime.stop(0));
    const { id } = await enrol(accounts, 'Ada Lovelace', 'ada@example.org');
    const directory = accounts.client(librarian);
    const got = await directory.invoke('accounts.profile.get', { ids: [id] });
    expect(got.list[0]).toMatchObject({ displayName: 'Ada Lovelace' });
    expect(got.list[0]).not.toHaveProperty('email');
    const refused = await settle(directory.invoke('accounts.profile.search', { text: 'ada' }));
    expect(refused.code).toBe('core.forbidden');
  });

  test('frozen keeps a deactivated profile read-only', { timeout }, async () => {
    const accounts = await bootAccounts(kind);
    onTestFinished(() => accounts.runtime.stop(0));
    const admin = accounts.client(operator);
    const { id } = await admin.invoke('accounts.profile.create', {
      displayName: 'Ada',
      email: 'ada@example.org',
      deactivatedAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
    });
    const again = await settle(admin.invoke('accounts.profile.deactivate', { id }));
    expect(again.code).toBe('core.not_found');
    const edited = await settle(
      admin.invoke('accounts.profile.update', flatUpdate({ id, displayName: 'Ada L.' })),
    );
    expect(edited.code).toBe('core.not_found');
    const active = await enrol(accounts, 'Grace', 'grace@example.org');
    const patched = await admin.invoke(
      'accounts.profile.update',
      flatUpdate({ id: active.id, displayName: 'Grace H.' }),
    );
    expect(patched).toMatchObject({ displayName: 'Grace H.' });
  });

  test('a tenant sees only its own profiles and may reuse an address', { timeout }, async () => {
    const accounts = await bootAccounts(kind);
    onTestFinished(() => accounts.runtime.stop(0));
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
