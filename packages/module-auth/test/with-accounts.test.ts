import { defineApp, type Id } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { startTestRuntime, testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, codeOf, grace, signIn, whoami } from './support/auth-calls.ts';
import { bootAuth, type StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';

const operator = testOperator();

describe.each(['memory', 'pglite'] as const)('auth with accounts on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(settings?: Parameters<typeof bootBoth>[1]): Promise<BootedBoth> {
    const both = await bootBoth(kind, settings);
    onTestFinished(() => both.runtime.stop());
    return both;
  }

  async function signUp(both: BootedBoth, person = ada, displayName?: string): Promise<string> {
    const done = await both.request('auth.signUp', {
      ...person,
      ...(displayName === undefined ? {} : { displayName }),
    });
    if (!done.ok) throw done.error;
    return (done.value as { credentialId: string }).credentialId;
  }

  const profileOf = (both: BootedBoth, id: string) =>
    both.client(operator).invoke('accounts.profile.get', { ids: [id as Id<'accounts.profile'>] });

  test('sign-up creates the profile and links it: the profile id is the subject', {
    timeout,
  }, async () => {
    const both = await boot();
    const credentialId = await signUp(both, ada, 'Ada Lovelace');
    const [credential] = await both.rows('auth.credential', { sealed: true });
    expect(credential).toMatchObject({
      id: credentialId,
      identifier: ada.identifier,
      kind: 'password',
    });
    const profileId = String(credential?.profileId);
    expect(credential?.subject).toBe(profileId);
    const profile = await profileOf(both, profileId);
    expect(profile.list).toMatchObject([{ displayName: 'Ada Lovelace', email: ada.identifier }]);
    const session = await signIn(both);
    const who = await whoami(both, asBearer(session.sessionToken));
    expect(who).toMatchObject({
      ok: true,
      value: { subject: profileId, displayName: 'Ada Lovelace' },
    });
  });

  test('without a display name the profile carries the identifier; a taken address is refused', {
    timeout,
  }, async () => {
    const both = await boot();
    await signUp(both);
    const [row] = (await both.client(operator).invoke('accounts.profile.query', {})).items;
    expect(row).toMatchObject({ displayName: ada.identifier });
    expect(codeOf(await both.request('auth.signUp', ada))).toBe('auth.identifier_taken');
    await both.client(operator).invoke('accounts.register', {
      displayName: 'Grace',
      email: grace.identifier,
    });
    // the profile exists, so the registration the sign-up invokes refuses with its own error
    expect(codeOf(await both.request('auth.signUp', grace))).toBe('accounts.email_taken');
    expect(await both.rows('accounts.profile', { sealed: true })).toHaveLength(2);
  });

  test('self-registration off refuses every sign-up as forbidden and leaves no credential behind', {
    timeout,
  }, async () => {
    const both = await boot({ accounts: { allowSelfRegistration: false } });
    const done = await both.request('auth.signUp', ada);
    expect(codeOf(done)).toBe('core.forbidden');
    expect(await both.rows('auth.credential')).toEqual([]);
    expect(await both.rows('accounts.profile')).toEqual([]);
    // an address that already has a profile answers the same, so the refusal tells nothing about profiles
    await both.client(operator).invoke('accounts.register', {
      displayName: 'Grace',
      email: grace.identifier,
    });
    expect(codeOf(await both.request('auth.signUp', grace))).toBe('core.forbidden');
    expect(await both.rows('auth.credential')).toEqual([]);
  });

  test('a login writes lastLoginAt to the profile the user reads', { timeout }, async () => {
    const both = await boot();
    await signUp(both);
    const session = await signIn(both);
    both.clock.advance({ minutes: 1 });
    const mine = await both.request(
      'accounts.profile.get',
      { ids: [String((await both.rows('auth.credential', { sealed: true }))[0]?.profileId)] },
      { headers: asBearer(session.sessionToken) },
    );
    expect(mine).toMatchObject({
      ok: true,
      value: { list: [{ email: ada.identifier, lastLoginAt: expect.anything() }] },
    });
    const [profile] = await both.rows('accounts.profile', { sealed: true });
    expect(String(profile?.lastLoginAt)).toContain('2026-11-05T09:00');
  });

  test('a user edits their own profile but not another one', { timeout }, async () => {
    const both = await boot();
    await signUp(both, ada, 'Ada');
    await signUp(both, grace, 'Grace');
    const session = await signIn(both);
    const profiles = await both.rows('accounts.profile', { sealed: true });
    const own = profiles.find((row) => row.email === ada.identifier);
    const other = profiles.find((row) => row.email === grace.identifier);
    const headers = asBearer(session.sessionToken);
    const edit = (id: unknown, displayName: string) =>
      both.request('accounts.profile.update', { id, patch: { displayName } }, { headers });
    expect((await edit(own?.id, 'Ada L.')).ok).toBe(true);
    expect(codeOf(await edit(other?.id, 'Hacked'))).toBeDefined();
    const after = await both.rows('accounts.profile', { sealed: true });
    expect(after.map((row) => row.displayName).toSorted()).toEqual(['Ada L.', 'Grace']);
  });

  test('deactivating a profile revokes its credentials and sessions in the same unit', {
    timeout,
  }, async () => {
    const both = await boot();
    await signUp(both);
    const first = await signIn(both);
    const second = await signIn(both);
    const profileId = String((await both.rows('accounts.profile'))[0]?.id);
    const done = await both.client(operator).invoke('accounts.profile.deactivate', {
      id: profileId as Id<'accounts.profile'>,
      reason: 'left',
    });
    expect(done).toBeDefined();
    const credentials = await both.rows('auth.credential');
    expect(credentials.every((row) => row.revokedAt !== null && row.revokedAt !== undefined)).toBe(
      true,
    );
    const sessions = await both.rows('auth.session');
    expect(sessions).toHaveLength(2);
    expect(sessions.every((row) => row.revokedAt !== null && row.revokedAt !== undefined)).toBe(
      true,
    );
    for (const session of [first, second]) {
      expect(codeOf(await whoami(both, asBearer(session.sessionToken)))).toBe(
        'core.unauthenticated',
      );
    }
    expect(codeOf(await both.request('auth.login', ada))).toBe('auth.invalid_credentials');
  });

  test('accounts.identities lists the sign-in methods auth fills in', { timeout }, async () => {
    const both = await boot();
    await signUp(both);
    const session = await signIn(both);
    const profileId = String((await both.rows('accounts.profile'))[0]?.id);
    const answer = await both.request(
      'accounts.identities',
      { profileId },
      { headers: asBearer(session.sessionToken) },
    );
    expect(answer).toMatchObject({
      ok: true,
      value: { providers: [{ id: 'auth.credentials', label: 'Sign-in methods' }] },
    });
  });

  test('a changed profile address becomes the login identifier', { timeout }, async () => {
    const both = await boot();
    await signUp(both);
    const profileId = String((await both.rows('accounts.profile'))[0]?.id);
    await both.client(operator).invoke('accounts.profile.update', {
      id: profileId as Id<'accounts.profile'>,
      patch: { email: 'ada@new.example' },
    });
    const [credential] = await both.rows('auth.credential', { sealed: true });
    expect(credential?.identifier).toBe('ada@new.example');
    expect(codeOf(await both.request('auth.login', ada))).toBe('auth.invalid_credentials');
    expect((await both.request('auth.login', { ...ada, identifier: 'ada@new.example' })).ok).toBe(
      true,
    );
  });
});

describe.each(['memory', 'pglite'] as const)('the toggle cases on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;
  const fieldsOf = (
    runtime: {
      readonly app: { readonly registry: { readonly entities: ReadonlyMap<string, never> } };
    },
    entity: string,
  ): readonly string[] => {
    const found = runtime.app.registry.entities.get(entity) as
      | { readonly descriptor: { readonly fields: Readonly<Record<string, unknown>> } }
      | undefined;
    return found === undefined ? [] : Object.keys(found.descriptor.fields);
  };

  const relationsOf = (
    runtime: {
      readonly app: { readonly registry: { readonly entities: ReadonlyMap<string, never> } };
    },
    entity: string,
  ): readonly string[] => {
    const found = runtime.app.registry.entities.get(entity) as
      | { readonly descriptor: { readonly relations: Readonly<Record<string, unknown>> } }
      | undefined;
    return found === undefined ? [] : Object.keys(found.descriptor.relations);
  };

  test('auth alone has no profile and its credential has no profile link', {
    timeout,
  }, async () => {
    const alone = await bootAuth(kind);
    onTestFinished(() => alone.runtime.stop());
    expect(fieldsOf(alone.runtime as never, 'accounts.profile')).toEqual([]);
    expect(fieldsOf(alone.runtime as never, 'auth.credential')).not.toContain('profileId');
    expect((await alone.request('auth.signUp', ada)).ok).toBe(true);
  });

  test('accounts alone has no credential relation and no auth columns on its profile', {
    timeout,
  }, async () => {
    const only = await startTestRuntime(
      defineApp({ id: 'accounts-only', modules: [accounts] as const }),
      {
        adapter: kind,
        operators: true,
        tenants: ['acme'],
        config: { accounts: { allowSelfRegistration: true } },
      },
    );
    onTestFinished(() => only.stop());
    expect(fieldsOf(only as never, 'auth.credential')).toEqual([]);
    expect(fieldsOf(only as never, 'accounts.profile')).not.toContain('lastLoginAt');
    expect(relationsOf(only as never, 'accounts.profile')).not.toContain('credentials');
  });

  test('both modules add the profile link, the credentials relation and the maskable last login', {
    timeout,
  }, async () => {
    const both = await bootBoth(kind);
    onTestFinished(() => both.runtime.stop());
    expect(relationsOf(both.runtime as never, 'accounts.profile')).toContain('credentials');
    expect(fieldsOf(both.runtime as never, 'auth.credential')).toContain('profileId');
    expect(fieldsOf(both.runtime as never, 'accounts.profile')).toContain('lastLoginAt');
    expect(fieldsOf(both.runtime as never, 'accounts.profile')).toContain('emailVerifiedAt');
  });
});
