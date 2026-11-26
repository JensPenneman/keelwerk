import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { acrossDeactivation } from './support/across-deactivation.ts';
import { bootedAt, type KeysStorage } from './support/boot-api-keys.ts';
import { bootOwnerApp, enrolOwner, liveKeyCount, seedKeys } from './support/boot-owner-app.ts';
import { failedAttempts, jobsOfKey, neverDue, watchStore } from './support/watch-store.ts';

const operator = testOperator();
const refusal = { kind: 'unauthenticated', message: 'The API key was not accepted.' };
/** What the enricher answers: the kernel's own text, which names no reason. */
const deactivatedRefusal = {
  kind: 'unauthenticated',
  message: 'The credentials were not accepted.',
};
/** The jobs a deactivation enqueues: a test makes them wait until it moves the clock to `neverDue`. */
const revocationJobs = ['auth.revokeSubject', 'api-keys.revokeSubject'];

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

    test('the work of the owner that starts after the deactivation fails unauthenticated while the revocation jobs are held', {
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
      for (const action of revocationJobs) watch.deferred.add(action);
      await app.client(operator).invoke('accounts.profile.deactivate', {
        id: profileId as never,
        reason: 'left',
      });
      // The deactivation wrote the profile only: the key is still unrevoked, its revocation is a job that waits.
      expect(await liveKeyCount(app)).toBe(1);
      expect(
        watch.enqueued.filter(
          (job) => 'action' in job.spec.run && job.spec.run.action === 'api-keys.revokeSubject',
        ),
      ).toHaveLength(1);
      await app.runtime.advanceTo(at);
      expect(failedAttempts(watch)).toEqual([
        {
          jobId: jobsOfKey(watch, owner.keyId)[0],
          outcome: 'failed:core.unauthenticated:unauthenticated',
        },
      ]);
      expect(await liveKeyCount(app)).toBe(1);
      const refused = await app.request('auth.whoami', {}, owner.key);
      expect(refused.ok ? undefined : refused.error).toMatchObject(deactivatedRefusal);
      // The revocation job's record leads back to the deactivation and says why it ran.
      const [job] = watch.enqueued.filter(
        (one) => 'action' in one.spec.run && one.spec.run.action === 'api-keys.revokeSubject',
      );
      expect(job?.spec.principal).toEqual({
        resolver: 'core.module',
        principalId: 'api-keys.system',
      });
      expect(job?.spec.run).toMatchObject({
        input: { subject: expect.any(String), reason: 'left' },
      });
      expect(job?.spec.causation).toMatchObject({
        commandId: expect.any(String),
        eventId: expect.any(String),
        actor: { kind: 'operator' },
      });
      const [authJob] = watch.enqueued.filter(
        (one) => 'action' in one.spec.run && one.spec.run.action === 'auth.revokeSubject',
      );
      expect(authJob?.spec.principal).toEqual({
        resolver: 'core.module',
        principalId: 'auth.system',
      });
      await app.runtime.advanceTo(neverDue);
      expect(await liveKeyCount(app)).toBe(0);
      // Once the job has run the key resolver refuses it with its own text: before, the enricher did.
      const afterJob = await app.request('auth.whoami', {}, owner.key);
      expect(afterJob.ok ? undefined : afterJob.error).toMatchObject(refusal);
    });

    test('a key created across a deactivation stands for nobody', { timeout }, async () => {
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
      // The create's own unit opened after the deactivation committed and made its key all the same.
      if (created === undefined || !created.ok) throw new Error('the create did not commit');
      const { key } = created.value as { key: string };
      expect(await liveKeyCount(app)).toBe(2);
      for (const token of [key, owner.key, owner.session.sessionToken]) {
        const refused = await app.request('auth.whoami', {}, token);
        expect(refused.ok ? undefined : refused.error.kind).toBe('unauthenticated');
      }
    });

    test('a command admitted before the deactivation commits after it, and the next request is refused', {
      timeout,
    }, async () => {
      const { app, watch, owner, profileId } = await boot();
      for (const action of revocationJobs) watch.deferred.add(action);
      let answer: Awaited<ReturnType<typeof app.request>> | undefined;
      await acrossDeactivation(app, profileId, async () => {
        answer = await app.request(
          'later.addBookAt',
          { at: bootedAt.add({ hours: 1 }), title: 'admitted', isbn: 'admitted' },
          owner.key,
        );
      });
      expect(answer?.ok).toBe(true);
      const next = await app.request('auth.whoami', {}, owner.key);
      expect(next.ok ? undefined : next.error).toMatchObject(deactivatedRefusal);
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
      await app.runtime.drainJobs();
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
