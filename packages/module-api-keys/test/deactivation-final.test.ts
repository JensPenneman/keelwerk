import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { acrossDeactivation } from './support/across-deactivation.ts';
import { bootedAt, type KeysStorage } from './support/boot-api-keys.ts';
import {
  bootOwnerApp,
  enrolOwner,
  liveKeyCount,
  patchProfileInStore,
} from './support/boot-owner-app.ts';
import { neverDue, watchStore } from './support/watch-store.ts';

const operator = testOperator();
/** What the enricher answers: the kernel's own text, which names no reason. */
const deactivatedRefusal = {
  kind: 'unauthenticated',
  message: 'The credentials were not accepted.',
};
const revocationJobs = ['auth.revokeSubject', 'api-keys.revokeSubject'];

describe.each(['memory', 'pglite'] as const)(
  'the deactivation of a person is final, on %s',
  (kind: KeysStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot() {
      const app = await bootOwnerApp(kind);
      onTestFinished(() => app.runtime.stop());
      const watch = watchStore(app.runtime.adapter);
      return { app, watch, owner: await enrolOwner(app), profileId: await app.profileId() };
    }

    test('an archive of a deactivated profile is refused, and its key and session stay refused', {
      timeout,
    }, async () => {
      const { app, watch, owner, profileId } = await boot();
      for (const action of revocationJobs) watch.deferred.add(action);
      const admin = app.client(operator);
      await admin.invoke('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
      const archive = await admin.attempt('accounts.profile.archive', { id: profileId as never });
      expect(archive.ok).toBe(false);
      for (const token of [owner.key, owner.session.sessionToken]) {
        const refused = await app.request('auth.whoami', {}, token);
        expect(refused.ok ? undefined : refused.error).toMatchObject(deactivatedRefusal);
      }
      // The revocation is clean-up: it has not run, and the refusal stood without it.
      expect(await liveKeyCount(app)).toBe(1);
    });

    test('a key made across the deactivation stays refused after a refused archive and a tried restore', {
      timeout,
    }, async () => {
      const { app, watch, owner, profileId } = await boot();
      for (const action of revocationJobs) watch.deferred.add(action);
      let created: Awaited<ReturnType<typeof app.request>> | undefined;
      await acrossDeactivation(app, profileId, async () => {
        created = await app.request(
          'api-keys.create',
          { label: 'late', scopes: ['write'] },
          owner.session.sessionToken,
        );
      });
      if (created === undefined || !created.ok) throw new Error('the create did not commit');
      const { key } = created.value as { key: string };
      // The jobs run: they revoke the keys they find, and a clean-up that missed a row leaves it.
      await app.runtime.advanceTo(neverDue);
      const admin = app.client(operator);
      expect((await admin.attempt('accounts.profile.archive', { id: profileId as never })).ok).toBe(
        false,
      );
      expect((await admin.attempt('accounts.profile.restore', { id: profileId as never })).ok).toBe(
        false,
      );
      const after = await app.request('auth.whoami', {}, key);
      expect(after.ok).toBe(false);
      expect(after.ok ? undefined : after.error.kind).toBe('unauthenticated');
    });

    test('a profile marked in the store, as 0.2.0 allowed through update, is refused and its rows are not revoked', {
      timeout,
    }, async () => {
      const { app, watch, owner, profileId } = await boot();
      await patchProfileInStore(app, profileId, { deactivatedAt: bootedAt });
      for (const token of [owner.key, owner.session.sessionToken]) {
        const refused = await app.request('auth.whoami', {}, token);
        expect(refused.ok ? undefined : refused.error).toMatchObject(deactivatedRefusal);
      }
      // `frozen` hides the marked row from deactivate, so no job is enqueued and nothing revokes the key.
      const again = await app
        .client(operator)
        .attempt('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
      expect(again.ok).toBe(false);
      await app.runtime.drainJobs();
      expect(
        watch.enqueued.filter(
          (job) => 'action' in job.spec.run && revocationJobs.includes(job.spec.run.action),
        ),
      ).toEqual([]);
      expect(await liveKeyCount(app)).toBe(1);
    });

    test('a profile marked and archived on 0.2.0 is answered while archived, and refused once an operator restores it', {
      timeout,
    }, async () => {
      const { app, owner, profileId } = await boot();
      await patchProfileInStore(app, profileId, { deactivatedAt: bootedAt, archivedAt: bootedAt });
      // The enricher does not see an archived profile: the key and the session are answered.
      for (const token of [owner.key, owner.session.sessionToken]) {
        expect((await app.request('auth.whoami', {}, token)).ok).toBe(true);
      }
      const restored = await app
        .client(operator)
        .attempt('accounts.profile.restore', { id: profileId as never });
      expect(restored.ok).toBe(true);
      for (const token of [owner.key, owner.session.sessionToken]) {
        const refused = await app.request('auth.whoami', {}, token);
        expect(refused.ok ? undefined : refused.error).toMatchObject(deactivatedRefusal);
      }
    });

    test('a batch is one request: the commands under a session opened before the deactivation commit, the next request is refused', {
      timeout,
    }, async () => {
      const { app, owner, profileId } = await boot();
      const carrier = {
        transport: 'test',
        headers: {
          'x-tenant': String(app.runtime.tenants.acme?.id),
          authorization: `Bearer ${owner.key}`,
        },
      };
      const opened = await app.runtime.invoker.open(carrier);
      if (!opened.ok) throw opened.error;
      await app
        .client(operator)
        .invoke('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
      for (const isbn of ['b1', 'b2']) {
        const member = await app.runtime.invoker.invoke({
          action: 'library.addBook',
          input: { title: isbn, isbn },
          carrier,
          session: opened.value,
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        });
        expect(member.ok).toBe(true);
      }
      const next = await app.request('auth.whoami', {}, owner.key);
      expect(next.ok ? undefined : next.error.kind).toBe('unauthenticated');
    });

    test('a timer that an earlier command of the person set still runs under the module own principal', {
      timeout,
    }, async () => {
      const { app, watch, owner, profileId } = await boot();
      const at = bootedAt.add({ hours: 1 });
      const set = await app.request('later.pingAt', { at, key: 'ping-1' }, owner.key);
      expect(set.ok).toBe(true);
      await app
        .client(operator)
        .invoke('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
      await app.runtime.advanceTo(at);
      const [job] = watch.enqueued.filter(
        (one) => 'action' in one.spec.run && one.spec.run.action === 'later.ping',
      );
      expect(job?.spec.principal).toEqual({ resolver: 'core.module', principalId: 'later.system' });
      const ran = watch.attempts.filter((attempt) => attempt.jobId === job?.jobId);
      expect(ran.map((attempt) => attempt.outcome.kind)).toEqual(['succeeded']);
    });
  },
);
