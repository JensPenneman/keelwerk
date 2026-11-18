import { createHmac } from 'node:crypto';
import { encodeAad, jobKeyInfo } from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createKey, keyOwner } from './support/api-key-calls.ts';
import { type BootedApiKeys, bootApiKeys, type KeysStorage } from './support/boot-api-keys.ts';

const retiredAt = Temporal.Instant.from('2026-12-02T00:00:05Z');

describe.each(['memory', 'pglite'] as const)('api-keys timer owners on %s', (kind: KeysStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedApiKeys> {
    const app = await bootApiKeys(kind);
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  /** Cancels a timer of the scope by its stored key text, as the job store matches it. */
  const cancelStored = (app: BootedApiKeys, key: string) =>
    app.runtime.adapter.unit(app.runtime.namespace, app.scope, (unit) =>
      unit.jobs.cancel('timers', key),
    );

  /**
   * The key api-keys' timer is stored under: its module id, a colon and the digest of the key text
   * under the scope's job key secret.
   */
  const storedKey = async (app: BootedApiKeys, key: string) =>
    `api-keys:${createHmac('sha256', await app.runtime.keys.derive(app.scope, jobKeyInfo, 32))
      .update(encodeAad(['api-keys', key]))
      .digest('hex')}`;

  test('the last-use timer is stored under the module of the key, out of reach of another module', {
    timeout,
  }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['read'] });
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    const cancelled = await app
      .as(keyOwner)
      .attempt('later.cancelTimerKey', { key: `api-keys.lastUse:${id}` });
    expect(cancelled.ok).toBe(true);
    expect(await cancelStored(app, `api-keys.lastUse:${id}`)).toBe(0);
    await app.runtime.drainJobs();
    expect((await app.row(id))?.lastUsedAt).toBeDefined();
    // The same timer under its stored key, which only api-keys builds, is the one that ends.
    const again = await createKey(app, { scopes: ['read'] });
    await app.withKey(again.key, 'library.book.query', {});
    expect(await cancelStored(app, await storedKey(app, `api-keys.lastUse:${again.id}`))).toBe(1);
    await app.runtime.drainJobs();
    expect((await app.row(again.id))?.lastUsedAt).toBeUndefined();
  });

  test('the re-pin timer is stored under the module of the key, out of reach of another module', {
    timeout,
  }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['write'], apiVersion: '2026-11-04' });
    await app.runtime.advanceTo(retiredAt);
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    const cancelled = await app
      .as(keyOwner)
      .attempt('later.cancelTimerKey', { key: `api-keys.repin:${id}` });
    expect(cancelled.ok).toBe(true);
    expect(await cancelStored(app, `api-keys.repin:${id}`)).toBe(0);
    await app.runtime.drainJobs();
    expect((await app.row(id))?.apiVersion).toBe('2026-11-11');
    const again = await createKey(app, { scopes: ['write'], apiVersion: '2026-11-04' });
    await app.withKey(again.key, 'library.book.query', {});
    expect(await cancelStored(app, await storedKey(app, `api-keys.repin:${again.id}`))).toBe(1);
    await app.runtime.drainJobs();
    expect((await app.row(again.id))?.apiVersion).toBe('2026-11-04');
  });
});
