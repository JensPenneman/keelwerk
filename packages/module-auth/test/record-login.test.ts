import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, signIn } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';
import { holdJobs } from './support/hold-jobs.ts';

describe.each(['memory', 'pglite'] as const)('recording a login on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedBoth> {
    const both = await bootBoth(kind);
    onTestFinished(() => both.runtime.stop());
    expect((await both.request('auth.signUp', ada)).ok).toBe(true);
    return both;
  }

  const rowOf = async (both: BootedBoth, entity: string): Promise<Record<string, unknown>> => {
    const [row] = await both.rows(entity, { sealed: true });
    if (row === undefined) throw new Error(`no ${entity}`);
    return row;
  };
  const lastLoginAt = async (both: BootedBoth): Promise<string | undefined> => {
    const value = (await rowOf(both, 'accounts.profile')).lastLoginAt;
    return value === undefined || value === null ? undefined : String(value);
  };
  const credentialEvents = async (both: BootedBoth): Promise<readonly string[]> => {
    const id = String((await rowOf(both, 'auth.credential')).id);
    const events = await both.inUnit((unit) =>
      unit.events.readStream({ type: 'auth.credential', id }),
    );
    return events.map((event) => event.type);
  };

  test('a login sets lastLoginAt through a job, equal to the credential lastUsedAt', {
    timeout,
  }, async () => {
    const both = await boot();
    // The workers take no job until the test lets them, so the state read next is the login's own.
    const held = holdJobs(both.runtime.adapter);
    both.clock.advance({ minutes: 3 });
    await signIn(both);
    // The login committed; the reaction is a job that has not run yet.
    expect(await lastLoginAt(both)).toBeUndefined();
    held.release();
    await both.settle();
    const used = String((await rowOf(both, 'auth.credential')).lastUsedAt);
    expect(used).toBe(both.clock.now().toString());
    expect(await lastLoginAt(both)).toBe(used);
  });

  test('an older login never overwrites a newer lastLoginAt, whatever order the jobs run in', {
    timeout,
  }, async () => {
    const both = await boot();
    const start = both.clock.now();
    both.clock.advance({ minutes: 10 });
    const newer = both.clock.now();
    await signIn(both);
    // A second server whose clock is behind logs the same person in later: an older login time.
    both.clock.set(start);
    await signIn(both);
    await both.settle();
    expect(await lastLoginAt(both)).toBe(newer.toString());
  });

  test('a password change leaves lastLoginAt as it was', { timeout }, async () => {
    const both = await boot();
    const session = await signIn(both);
    await both.settle();
    const before = await lastLoginAt(both);
    expect(before).toBeDefined();
    both.clock.advance({ hours: 1 });
    const changed = await both.request(
      'accounts.profile.changePassword',
      {
        id: String((await rowOf(both, 'accounts.profile')).id),
        currentPassword: ada.password,
        newPassword: 'another long enough password',
      },
      { headers: asBearer(session.sessionToken) },
    );
    expect(changed.ok).toBe(true);
    await both.settle();
    expect(await lastLoginAt(both)).toBe(before);
  });

  test('a login without a rehash appends one loggedIn event and no changed event', {
    timeout,
  }, async () => {
    const both = await boot();
    const before = await credentialEvents(both);
    await signIn(both);
    const after = await credentialEvents(both);
    expect(after.slice(before.length)).toEqual(['auth.credential.loggedIn']);
  });
});
