import { describe, expect, onTestFinished, test } from 'vitest';
import { createKey, keyOwnerSubject, otherPerson } from './support/api-key-calls.ts';
import { bootApiKeys, bootedAt, type KeysStorage } from './support/boot-api-keys.ts';
import { failedAttempts, jobsOfKey, specsOfKey, watchStore } from './support/watch-store.ts';

const hours = (count: number): Temporal.Instant => bootedAt.add({ hours: count });
const refusal = { kind: 'unauthenticated', message: 'The API key was not accepted.' };

describe.each(['memory', 'pglite'] as const)(
  'the keys of an erased owner on %s',
  (kind: KeysStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    test('a key of an erased owner stops resolving at a request, and its queued work never runs', {
      timeout,
    }, async () => {
      const app = await bootApiKeys(kind, { erasing: true });
      onTestFinished(() => app.runtime.stop());
      const watch = watchStore(app.runtime.adapter);
      const erased = await createKey(app, { scopes: ['write'] });
      const kept = await createKey(app, { scopes: ['write'] }, otherPerson);
      const book = (token: string, isbn: string) =>
        app.withKey(token, 'later.addBookAt', { at: hours(1), title: isbn, isbn });
      expect((await book(erased.key, 'erased')).ok).toBe(true);
      expect((await book(kept.key, 'kept')).ok).toBe(true);
      // The controls: both keys resolve, and the owner's key has a row.
      expect((await app.withKey(erased.key, 'library.book.query', {})).ok).toBe(true);
      expect((await app.withKey(kept.key, 'library.book.query', {})).ok).toBe(true);
      expect(await app.row(erased.id)).toBeDefined();
      const queued = jobsOfKey(watch, erased.id);
      expect(queued).toHaveLength(1);

      await app.erase(keyOwnerSubject);

      // At a request: the key no longer resolves; another owner's key does.
      const refused = await app.withKey(erased.key, 'library.book.query', {});
      expect(refused.ok ? undefined : refused.error).toMatchObject(refusal);
      expect((await app.open(erased.key)).ok).toBe(false);
      expect((await app.withKey(kept.key, 'library.book.query', {})).ok).toBe(true);
      expect(await app.row(erased.id)).toBeUndefined();

      // At the re-resolution of a queued job: the owner's job is purged with the owner's other
      // principals, so it never reaches a worker; the other owner's job runs.
      await app.runtime.advanceTo(hours(1));
      const books = await app.withKey(kept.key, 'library.book.query', {});
      expect(
        books.ok ? (books.value as { items: { isbn: string }[] }).items.map((b) => b.isbn) : [],
      ).toEqual(['kept']);
      expect(failedAttempts(watch)).toEqual([]);
      expect(watch.attempts.map((attempt) => attempt.jobId)).not.toContain(queued[0]);
    });

    test('a job of an erased owner that a worker still held at the erasure fails when it is taken again', {
      timeout,
    }, async () => {
      const app = await bootApiKeys(kind, { erasing: true });
      onTestFinished(() => app.runtime.stop());
      const watch = watchStore(app.runtime.adapter);
      const erased = await createKey(app, { scopes: ['write'] });
      const kept = await createKey(app, { scopes: ['write'] }, otherPerson);
      const book = (token: string, isbn: string) =>
        app.withKey(token, 'later.addBookAt', { at: hours(1), title: isbn, isbn });
      expect((await book(erased.key, 'erased')).ok).toBe(true);
      expect((await book(kept.key, 'kept')).ok).toBe(true);
      const [waiting] = specsOfKey(watch, erased.id);
      if (waiting === undefined) throw new Error('the owner has no queued job');
      // The owner's job as a running one: a copy due now, taken with the shortest lease while no
      // worker takes. An erasure keeps a running job.
      watch.paused = 'probe.holding';
      const id = await app.runtime.adapter.unit(app.runtime.namespace, waiting.scope, (unit) =>
        unit.jobs.enqueue({ ...waiting, runAt: bootedAt }),
      );
      const held = await app.runtime.adapter.unit(
        app.runtime.namespace,
        waiting.scope,
        async (unit) => {
          const { jobs } = await unit.jobs.take('commands', 'probe.holding', {
            limit: 1,
            capabilitySets: [''],
            maxRevision: waiting.build.revision,
            leaseMs: 1,
          });
          return { id, taken: jobs.map((job) => job.id) };
        },
      );
      watch.paused = undefined;
      expect(held.taken).toEqual([held.id]);

      await app.erase(keyOwnerSubject);

      // The lease has run out: a worker takes the job again and re-resolves its principal.
      await app.runtime.advanceTo(bootedAt.add({ seconds: 1 }));
      expect(failedAttempts(watch)).toEqual([
        { jobId: held.id, outcome: 'failed:core.unauthenticated:unauthenticated' },
      ]);
      await app.runtime.advanceTo(hours(1));
      const books = await app.withKey(kept.key, 'library.book.query', {});
      expect(
        books.ok ? (books.value as { items: { isbn: string }[] }).items.map((b) => b.isbn) : [],
      ).toEqual(['kept']);
    });
  },
);
