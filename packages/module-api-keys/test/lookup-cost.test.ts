import { describe, expect, onTestFinished, test } from 'vitest';
import { createKey, keyOwner, refusalOf, unknownKey } from './support/api-key-calls.ts';
import {
  type BootedApiKeys,
  bootApiKeys,
  bootedAt,
  type KeysStorage,
} from './support/boot-api-keys.ts';
import { type KeyStoreCalls, watchStore } from './support/watch-store.ts';

const hours = (count: number): Temporal.Instant => bootedAt.add({ hours: count });

describe.each(['memory', 'pglite'] as const)('api-keys lookup cost on %s', (kind: KeysStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedApiKeys> {
    const app = await bootApiKeys(kind);
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  test('a key that exists, is revoked, is expired, belongs to another tenant or is unknown costs the same key-store work and answers the same refusal', {
    timeout,
  }, async () => {
    const app = await boot();
    const watch = watchStore(app.runtime.adapter);
    const live = await createKey(app, { scopes: ['read'] });
    const revoked = await createKey(app, { scopes: ['read'] });
    const expiring = await createKey(app, { scopes: ['read'], expiresAt: hours(1) });
    const abroad = await app.as(keyOwner, 'globex').attempt('api-keys.create', {
      label: 'elsewhere',
      scopes: ['read'],
    });
    if (!abroad.ok) throw abroad.error;
    const foreign = (abroad.value as { key: string }).key;
    expect((await app.as(keyOwner).attempt('api-keys.key.revoke', { id: revoked.id })).ok).toBe(
      true,
    );
    await app.runtime.advanceTo(hours(2));
    const cases: readonly (readonly [string, string])[] = [
      ['live', live.key],
      ['revoked', revoked.key],
      ['expired', expiring.key],
      ['another tenant', foreign],
      ['unknown', unknownKey()],
    ];
    const counted: Record<string, KeyStoreCalls> = {};
    const refusals = new Set<string>();
    for (const [name, token] of cases) {
      watch.startCounting();
      const opened = await app.open(token);
      counted[name] = { ...watch.calls };
      if (name === 'live') {
        expect(opened.ok, name).toBe(true);
        continue;
      }
      const refusal = refusalOf(opened);
      expect(refusal?.kind, name).toBe('unauthenticated');
      refusals.add(JSON.stringify(refusal));
    }
    expect(refusals.size).toBe(1);
    // A found row reads key material through `keyById` and `openValue`; the decoy a missing row
    // takes reads the same material through `dataKey`. Each lookup does the same number of reads.
    const reads = (calls: KeyStoreCalls): number => calls.keyById + calls.openValue + calls.dataKey;
    const [first, ...others] = Object.values(counted);
    expect(first?.openValue).toBeGreaterThan(0);
    expect(first?.keyById).toBeGreaterThan(0);
    expect(reads(first as KeyStoreCalls)).toBe(2);
    for (const other of others) expect(reads(other)).toBe(2);
    // The decoy is a real key of the scope: both reads find it.
    expect(counted.unknown?.dataKeyFound).toBe(2);
  });
});
