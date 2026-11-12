import { describe, expect, onTestFinished, test } from 'vitest';
import { createKey, keyOwner } from './support/api-key-calls.ts';
import {
  type BootedApiKeys,
  bootApiKeys,
  bootedAt,
  type KeysStorage,
} from './support/boot-api-keys.ts';

describe.each(['memory', 'pglite'] as const)('api-keys timers on %s', (kind: KeysStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedApiKeys> {
    const app = await bootApiKeys(kind);
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  test('lastUsedAt moves at most once an hour', { timeout }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['read'] });
    const lastUse = async () => (await app.row(id))?.lastUsedAt?.toString();
    expect(await lastUse()).toBeUndefined();
    await app.withKey(key, 'library.book.query', {});
    await app.runtime.drainJobs();
    expect(await lastUse()).toBe(bootedAt.toString());
    await app.runtime.advanceTo(bootedAt.add({ minutes: 10 }));
    await app.withKey(key, 'library.book.query', {});
    await app.runtime.drainJobs();
    expect(await lastUse()).toBe(bootedAt.toString());
    const later = bootedAt.add({ minutes: 61 });
    await app.runtime.advanceTo(later);
    await app.withKey(key, 'library.book.query', {});
    await app.runtime.drainJobs();
    expect(await lastUse()).toBe(later.toString());
  });

  test('a key pinned to a retired version is re-pinned and still works', { timeout }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['write'], apiVersion: '2026-11-04' });
    const before = await app.open(key);
    expect(before.ok ? before.value.apiVersion : undefined).toBe('2026-11-04');
    await app.runtime.advanceTo(Temporal.Instant.from('2026-12-02T00:00:05Z'));
    expect((await app.row(id))?.apiVersion).toBe('2026-11-04');
    const after = await app.open(key);
    expect(after.ok ? after.value.apiVersion : undefined).toBe('2026-11-11');
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    await app.runtime.drainJobs();
    expect((await app.row(id))?.apiVersion).toBe('2026-11-11');
    const settled = await app.open(key);
    expect(settled.ok ? settled.value.apiVersion : undefined).toBe('2026-11-11');
    expect(await app.runtime.drainJobs()).toBe(0);
  });

  test('a read-only key pinned to a retired version is re-pinned', { timeout }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['read'], apiVersion: '2026-11-04' });
    await app.runtime.advanceTo(Temporal.Instant.from('2026-12-02T00:00:05Z'));
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    await app.runtime.drainJobs();
    expect((await app.row(id))?.apiVersion).toBe('2026-11-11');
  });

  test('the last use of a read-only key is recorded', { timeout }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['read'] });
    await app.withKey(key, 'library.book.query', {});
    await app.runtime.drainJobs();
    expect((await app.row(id))?.lastUsedAt?.toString()).toBe(bootedAt.toString());
  });

  test('the timer commands cannot be called from outside, by a person or by a key', {
    timeout,
  }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['write'] });
    const calls: readonly (readonly [string, unknown])[] = [
      ['api-keys.recordUse', { keyId: id }],
      ['api-keys.repinKey', { keyId: id, apiVersion: '2026-11-11' }],
    ];
    for (const [action, input] of calls) {
      const byPerson = await app
        .as(keyOwner)
        .attempt(action as 'api-keys.recordUse', input as never);
      expect(byPerson.ok ? undefined : byPerson.error.kind, action).toBe('forbidden');
      const byKey = await app.withKey(key, action, input);
      expect(byKey.ok ? undefined : byKey.error.kind, action).toBe('forbidden');
    }
    expect((await app.row(id))?.lastUsedAt).toBeUndefined();
  });
});
