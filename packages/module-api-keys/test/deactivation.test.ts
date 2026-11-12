import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { bootedAt, type KeysStorage } from './support/boot-api-keys.ts';
import { bootOwnerApp, enrolOwner, liveKeyCount, seedKeys } from './support/boot-owner-app.ts';
import { failedAttempts, jobsOfKey, watchStore } from './support/watch-store.ts';

const operator = testOperator();
const refusal = { kind: 'unauthenticated', message: 'The API key was not accepted.' };

describe.each(['memory', 'pglite'] as const)(
  'keys of a person an operator acts on, on %s',
  (kind: KeysStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot() {
      const app = await bootOwnerApp(kind);
      onTestFinished(() => app.runtime.stop());
      const watch = watchStore(app.runtime.adapter);
      return { app, watch, owner: await enrolOwner(app), profileId: await app.profileId() };
    }

    test('deactivating the owner revokes the key, and its queued work fails unauthenticated', {
      timeout,
    }, async () => {
      const { app, watch, owner, profileId } = await boot();
      const at = bootedAt.add({ hours: 1 });
      const queued = await app.request(
        'later.addBookAt',
        { at, title: 'late', isbn: 'late' },
        owner.key,
      );
      expect(queued.ok).toBe(true);
      expect((await app.request('auth.whoami', {}, owner.key)).ok).toBe(true);
      await app.client(operator).invoke('accounts.profile.deactivate', {
        id: profileId as never,
        reason: 'left',
      });
      const refused = await app.request('auth.whoami', {}, owner.key);
      expect(refused.ok ? undefined : refused.error).toMatchObject(refusal);
      await app.runtime.advanceTo(at);
      expect(failedAttempts(watch)).toEqual([
        {
          jobId: jobsOfKey(watch, owner.keyId)[0],
          outcome: 'failed:core.unauthenticated:unauthenticated',
        },
      ]);
    });

    test('a person with more keys than a page holds cannot hold back their deactivation', {
      timeout: kind === 'pglite' ? 120_000 : 30_000,
    }, async () => {
      const { app, owner, profileId } = await boot();
      await seedKeys(app, owner.keyId, 1004);
      expect(await liveKeyCount(app)).toBe(1005);
      const done = await app.client(operator).attempt('accounts.profile.deactivate', {
        id: profileId as never,
        reason: 'left',
      });
      expect(done.ok ? undefined : done.error).toBeUndefined();
      expect(await liveKeyCount(app)).toBe(0);
      const refused = await app.request('auth.whoami', {}, owner.key);
      expect(refused.ok ? undefined : refused.error).toMatchObject(refusal);
    });

    test('a person holds at most a hundred unrevoked keys, and a revoked one frees a place', {
      timeout,
    }, async () => {
      const { app, owner } = await boot();
      const make = () =>
        app.request(
          'api-keys.create',
          { label: 'more', scopes: ['read'] },
          owner.session.sessionToken,
        );
      for (let held = 1; held < 100; held += 1) expect((await make()).ok).toBe(true);
      const refused = await make();
      expect(refused.ok ? undefined : refused.error.kind).toBe('conflict');
      const revoked = await app.request(
        'api-keys.key.revoke',
        { id: owner.keyId },
        owner.session.sessionToken,
      );
      expect(revoked.ok).toBe(true);
      expect((await make()).ok).toBe(true);
    });

    test('an operator revokes a key, and reads none', { timeout }, async () => {
      const { app, owner } = await boot();
      const revoked = await app
        .client(operator)
        .attempt('api-keys.key.revoke', { id: owner.keyId as never });
      expect(revoked.ok).toBe(true);
      const refused = await app.request('auth.whoami', {}, owner.key);
      expect(refused.ok ? undefined : refused.error).toMatchObject(refusal);
      const read = await app.client(operator).attempt('api-keys.key.query', {});
      expect(read.ok ? read.value.items : []).toEqual([]);
    });
  },
);
