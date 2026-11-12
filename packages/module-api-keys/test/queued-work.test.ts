import { describe, expect, onTestFinished, test } from 'vitest';
import { createKey, keyOwner } from './support/api-key-calls.ts';
import {
  type BootedApiKeys,
  bootApiKeys,
  bootedAt,
  type KeysStorage,
} from './support/boot-api-keys.ts';
import { failedAttempts, jobsOfKey, type StoreWatch, watchStore } from './support/watch-store.ts';

const hours = (count: number): Temporal.Instant => bootedAt.add({ hours: count });

describe.each(['memory', 'pglite'] as const)('api-keys queued work on %s', (kind: KeysStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<{ app: BootedApiKeys; watch: StoreWatch }> {
    const app = await bootApiKeys(kind);
    onTestFinished(() => app.runtime.stop());
    return { app, watch: watchStore(app.runtime.adapter) };
  }

  const queue = (app: BootedApiKeys, token: string, at: Temporal.Instant, isbn: string) =>
    app.withKey(token, 'later.addBookAt', { at, title: isbn, isbn });

  test('revoking a key stops queued work at its next re-resolution: the attempt fails unauthenticated', {
    timeout,
  }, async () => {
    const { app, watch } = await boot();
    const stopped = await createKey(app, { scopes: ['write'] });
    const kept = await createKey(app, { scopes: ['write'] });
    expect((await queue(app, stopped.key, hours(1), 'stopped')).ok).toBe(true);
    expect((await queue(app, kept.key, hours(1), 'kept')).ok).toBe(true);
    expect((await app.as(keyOwner).attempt('api-keys.key.revoke', { id: stopped.id })).ok).toBe(
      true,
    );
    await app.runtime.advanceTo(hours(1));
    const books = await app.as(keyOwner).invoke('library.book.query', {});
    expect(books.items.map((book) => book.isbn)).toEqual(['kept']);
    // The kept book shows the other job ran; the one attempt that failed is the stopped key's job.
    expect(failedAttempts(watch)).toEqual([
      {
        jobId: onlyJobOf(watch, stopped.id),
        outcome: 'failed:core.unauthenticated:unauthenticated',
      },
    ]);
  });

  test('an expired key stops queued work at its next re-resolution: the attempt fails unauthenticated', {
    timeout,
  }, async () => {
    const { app, watch } = await boot();
    const expiring = await createKey(app, { scopes: ['write'], expiresAt: hours(1) });
    const lasting = await createKey(app, { scopes: ['write'], expiresAt: hours(3) });
    expect((await queue(app, expiring.key, hours(2), 'expiring')).ok).toBe(true);
    expect((await queue(app, lasting.key, hours(2), 'lasting')).ok).toBe(true);
    await app.runtime.advanceTo(hours(2));
    const books = await app.as(keyOwner).invoke('library.book.query', {});
    expect(books.items.map((book) => book.isbn)).toEqual(['lasting']);
    // The kept book shows the other job ran; the one attempt that failed is the expired key's job.
    expect(failedAttempts(watch)).toEqual([
      {
        jobId: onlyJobOf(watch, expiring.id),
        outcome: 'failed:core.unauthenticated:unauthenticated',
      },
    ]);
  });
});

/** The one job a key enqueued. */
function onlyJobOf(watch: StoreWatch, keyId: string): string {
  const jobs = jobsOfKey(watch, keyId);
  expect(jobs).toHaveLength(1);
  return jobs[0] ?? '';
}
