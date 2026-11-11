import { describe, expect, it } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { memoryScopeKeys } from '../../test/keys/memory-scope-keys.ts';
import type { ScopeKeyStore } from '../storage/scope-key-store.ts';
import type { Unit } from '../storage/unit.ts';
import type { WrappedScopeKey } from '../storage/wrapped-scope-key.ts';
import { createKeyService } from './create-key-service.ts';
import { issueSecret } from './issue-secret.ts';
import { createKeyCache } from './key-cache.ts';
import { parseToken } from './parse-token.ts';
import { sealedValueRef } from './sealed-value-ref.ts';
import { unwrapKey } from './unwrap-key.ts';
import { wrapKey } from './wrap-key.ts';

const master = { version: 3, material: new Uint8Array(32).fill(9) };
const tenant = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
const otherTenant = { level: 'tenant', backendId: 'b1', tenantId: 't2' } as const;
const backend = { level: 'backend', backendId: 'b1' } as const;
const clock = { now: () => Temporal.Instant.from('2026-11-05T10:00:00Z') };

function setup(cache?: { now?: () => number; ttlMs?: number }) {
  const store = memoryScopeKeys();
  const service = createKeyService({
    master: { current: async () => master, byVersion: async (v) => (v === 3 ? master : undefined) },
    deploymentId: 'dep',
    withScopeKeys: store.withScopeKeys,
    clock,
    random: countingRandomSource(),
    ...(cache === undefined ? {} : { cache }),
  });
  return { service, store };
}

describe('token issue and verify', () => {
  it('issues <prefix>_<public id>_<secret> in base32 and verifies it', async () => {
    const { service } = setup();
    const issued = await service.issue(tenant, { prefix: 'pss' });
    const parsed = parseToken(issued.plain);
    expect(parsed?.prefix).toBe('pss');
    expect(parsed?.publicId).toHaveLength(26);
    expect(parsed?.secret).toHaveLength(52);
    expect(issued.publicId).toBe(parsed?.publicId);
    expect(issued.verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.plain).not.toContain(issued.verifier);
    expect(await service.verify(tenant, issued.plain, issued.verifier)).toBe(true);
  });

  it('rejects a wrong prefix, a wrong secret, another scope and malformed tokens', async () => {
    const { service } = setup();
    const issued = await service.issue(tenant, { prefix: 'pss' });
    const parsed = parseToken(issued.plain);
    expect(await service.verify(tenant, issued.plain.replace(/^pss/, 'kws'), issued.verifier)).toBe(
      false,
    );
    expect(
      await service.verify(tenant, `pss_${parsed?.publicId}_${'a'.repeat(52)}`, issued.verifier),
    ).toBe(false);
    expect(await service.verify(otherTenant, issued.plain, issued.verifier)).toBe(false);
    expect(await service.verify(backend, issued.plain, issued.verifier)).toBe(false);
    expect(await service.verify(tenant, 'garbage', issued.verifier)).toBe(false);
    expect(await service.verify(tenant, issued.plain, 'short')).toBe(false);
  });

  it('honours the secret size and refuses a bad prefix', async () => {
    const { service } = setup();
    const issued = await service.issue(tenant, { prefix: 'key', bytes: 16 });
    expect(parseToken(issued.plain)?.secret).toHaveLength(26);
    await expect(service.issue(tenant, { prefix: 'Bad_Prefix' })).rejects.toMatchObject({
      code: 'core.validation',
    });
    await expect(service.issue(tenant, { prefix: 'key', bytes: 8 })).rejects.toMatchObject({
      code: 'core.validation',
    });
  });

  it('verifies nothing for a scope that never had a key, without creating one', async () => {
    const { service, store } = setup();
    expect(await service.verify(tenant, 'pss_x', 'v')).toBe(false);
    expect(store.rows).toHaveLength(0);
  });

  it('is final: golden token and verifier for a fixed key and fixed randomness', () => {
    const issued = issueSecret(
      new Uint8Array(32).fill(1),
      { prefix: 'pss' },
      countingRandomSource(),
    );
    expect(issued.plain).toBe(
      'pss_aaaqeayeaudaocajbifqydiob4_caireeyuculbogazdinryhi6d4qccirdeqssmjzifevcwlbnfyxq',
    );
    expect(issued.verifier).toBe(
      'fd969ddc9a28f7eabf21099f1193041b646cce966dbbe24930d94b103e664772',
    );
  });
});

describe('scope keys', () => {
  it('creates one wrapped key per scope, once, bound to its scope', async () => {
    const { service, store } = setup();
    await Promise.all([
      service.issue(tenant, { prefix: 'a' }),
      service.issue(tenant, { prefix: 'b' }),
      service.issue(tenant, { prefix: 'c' }),
    ]);
    await service.issue(backend, { prefix: 'a' });
    await service.derive({ level: 'deployment' }, 'x', 16);
    expect(store.rows.map((r) => `${r.level}:${r.scopeId}:${r.version}`).sort()).toEqual([
      'backend:b1:1',
      'deployment:dep:1',
      'tenant:t1:1',
    ]);
    const row = store.rows.find((r) => r.level === 'tenant');
    expect(row?.wrapped).toBeDefined();
    const binding = { level: 'tenant', scopeId: 't1', version: 1 } as const;
    const lookup = async (v: number) => (v === 3 ? master : undefined);
    expect(await unwrapKey(row?.wrapped ?? new Uint8Array(), binding, lookup)).toHaveLength(32);
    expect(
      await unwrapKey(row?.wrapped ?? new Uint8Array(), { ...binding, scopeId: 't2' }, lookup),
    ).toBeUndefined();
    expect(
      await unwrapKey(row?.wrapped ?? new Uint8Array(), { ...binding, level: 'backend' }, lookup),
    ).toBeUndefined();
    expect(
      await unwrapKey(row?.wrapped ?? new Uint8Array(), binding, async () => undefined),
    ).toBeUndefined();
  });

  it('is final: golden wrapped key', () => {
    const wrapped = wrapKey(
      master,
      { level: 'tenant', scopeId: 't1', version: 1 },
      new Uint8Array(32).fill(1),
      countingRandomSource(),
    );
    expect(Buffer.from(wrapped).toString('hex')).toBe(
      '0100000003000102030405060708090a0beb509ac33d4e2be49e572d9ed1c2c435d2748ea39c113da57e0f31f747c8feda54373118835eaa5060265acecd216d0d',
    );
  });

  it('derives purpose-bound keys, and tenants cannot reach each other', async () => {
    const { service } = setup();
    const a = await service.derive(tenant, 'keelwerk/index-root/1', 32);
    expect(a).toEqual(await service.derive(tenant, 'keelwerk/index-root/1', 32));
    expect(a).not.toEqual(await service.derive(tenant, 'keelwerk/other/1', 32));
    expect(a).not.toEqual(await service.derive(otherTenant, 'keelwerk/index-root/1', 32));
  });

  it('refuses the kernel-internal namespace scope', async () => {
    const { service } = setup();
    await expect(
      service.issue({ level: 'namespace', reason: 'migrate' }, { prefix: 'a' }),
    ).rejects.toMatchObject({ code: 'core.internal' });
  });

  it('fails loudly, not silently, when a wrapped key cannot be unwrapped', async () => {
    const { service, store } = setup();
    await service.issue(tenant, { prefix: 'a' });
    service.invalidate(tenant);
    const row = store.rows[0];
    if (row !== undefined) store.rows[0] = { ...row, wrapped: new Uint8Array(40) };
    await expect(service.issue(tenant, { prefix: 'a' })).rejects.toThrow(/cannot be unwrapped/);
  });
});

describe('the unwrapped key cache', () => {
  it('reads the control store once per minute and drops entries on invalidation', async () => {
    let now = 0;
    const { service, store } = setup({ now: () => now });
    await service.issue(tenant, { prefix: 'a' }); // creates
    await service.issue(tenant, { prefix: 'a' }); // reads and caches
    const afterWarm = store.calls.count;
    await service.issue(tenant, { prefix: 'a' });
    await service.verify(tenant, 'pss_x', 'v');
    expect(store.calls.count).toBe(afterWarm);
    service.invalidate(tenant);
    await service.issue(tenant, { prefix: 'a' });
    expect(store.calls.count).toBe(afterWarm + 1);
    now += 60_001;
    await service.issue(tenant, { prefix: 'a' });
    expect(store.calls.count).toBe(afterWarm + 2);
  });

  it('is bounded and expires entries', () => {
    let now = 0;
    const cache = createKeyCache<number>({ maxEntries: 2, ttlMs: 10, now: () => now });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    now = 11;
    expect(cache.get('b')).toBeUndefined();
    cache.set('x', 1);
    cache.delete('x');
    expect(cache.get('x')).toBeUndefined();
  });
});

describe('reveal', () => {
  const unitOf = (
    open: (v: unknown, expected?: unknown) => Promise<Uint8Array | undefined>,
  ): Unit => ({ keys: { openValue: open } }) as unknown as Unit;
  const sealed = { keyId: 'k1', nonce: Uint8Array.of(1), ciphertext: Uint8Array.of(2) };

  it('returns the opened value and logs the reason, not the value', async () => {
    const lines: unknown[] = [];
    const store = memoryScopeKeys();
    const service = createKeyService({
      master: { current: async () => master, byVersion: async () => master },
      deploymentId: 'dep',
      withScopeKeys: store.withScopeKeys,
      clock,
      log: { info: (m: string, f?: unknown) => lines.push([m, f]) } as never,
    });
    const value = await service.reveal(
      unitOf(async () => new TextEncoder().encode('s3cret')),
      sealedValueRef(sealed),
      'deploy',
    );
    expect(value).toBe('s3cret');
    expect(JSON.stringify(lines)).toContain('deploy');
    expect(JSON.stringify(lines)).not.toContain('s3cret');
  });

  it('opens a sealed value only for the binding it was sealed for: one copied to another effect or member is not found', async () => {
    const { service } = setup();
    const bound = { entity: 'core.effect', id: 'e1', field: 'signingKey' };
    const unit = unitOf(async (_value, expected) => {
      const wanted = expected as typeof bound | undefined;
      return wanted?.entity === bound.entity &&
        wanted.id === bound.id &&
        wanted.field === bound.field
        ? new TextEncoder().encode('s3cret')
        : undefined;
    });
    expect(await service.reveal(unit, sealedValueRef(sealed), 'sign', bound)).toBe('s3cret');
    await expect(
      service.reveal(unit, sealedValueRef(sealed), 'sign', { ...bound, id: 'e2' }),
    ).rejects.toMatchObject({ code: 'core.not_found' });
    await expect(
      service.reveal(unit, sealedValueRef(sealed), 'sign', { ...bound, field: 'other' }),
    ).rejects.toMatchObject({ code: 'core.not_found' });
  });

  it('fails with not_found once the value key is destroyed', async () => {
    const { service } = setup();
    await expect(
      service.reveal(
        unitOf(async () => undefined),
        sealedValueRef(sealed),
        'deploy',
      ),
    ).rejects.toMatchObject({ code: 'core.not_found' });
  });
});

describe('a key service bound to an open unit (within)', () => {
  const scope = { level: 'deployment' } as const;
  const setupWithin = () => {
    const store = memoryScopeKeys();
    const service = createKeyService({
      master: { current: async () => master, byVersion: async () => master },
      deploymentId: 'dep',
      withScopeKeys: store.withScopeKeys,
      clock: { now: () => Temporal.Instant.from('2026-11-05T10:00:00Z') },
      random: countingRandomSource(),
    });
    return { service, store };
  };
  // A unit's own store: what it adds becomes visible in the shared rows only on commit.
  const unitStore = (committed: WrappedScopeKey[]) => {
    const staged: WrappedScopeKey[] = [];
    const store: ScopeKeyStore = {
      current: async (scopeId) =>
        [...committed, ...staged].filter((r) => r.scopeId === scopeId).at(-1),
      byVersion: async (scopeId, version) =>
        [...committed, ...staged].find((r) => r.scopeId === scopeId && r.version === version),
      add: async (key) => {
        staged.push(key);
      },
      retire: async () => undefined,
      destroy: async () => undefined,
    };
    return { store, commit: () => committed.push(...staged.splice(0)) };
  };

  it('parallel units: one that fails after creating a key leaves one row and nothing cached', async () => {
    const { service, store } = setupWithin();
    const failing = unitStore(store.rows);
    const passing = unitStore(store.rows);
    const issueIn = async (unit: ReturnType<typeof unitStore>, fail: boolean) => {
      const issued = await service.within(unit.store).issue(scope, { prefix: 'kwo' });
      if (fail) throw new Error('the command throws after creating the key');
      unit.commit();
      return issued;
    };
    const results = await Promise.allSettled([issueIn(failing, true), issueIn(passing, false)]);
    expect(results.map((one) => one.status)).toEqual(['rejected', 'fulfilled']);
    expect(store.rows).toHaveLength(1);
    expect(store.calls.count).toBe(0);
    const passed = results[1];
    if (passed?.status !== 'fulfilled') throw new Error('unreachable');
    // The service reads the committed row: the failed unit's key was never cached or shared.
    expect(await service.verify(scope, passed.value.plain, passed.value.verifier)).toBe(true);
  });

  it('never writes the shared cache and never opens a unit of its own', async () => {
    const { service, store } = setupWithin();
    const first = await service.issue(scope, { prefix: 'kwo' });
    const calls = store.calls.count;
    const unit = unitStore(store.rows);
    const within = service.within(unit.store);
    expect(await within.verify(scope, first.plain, first.verifier)).toBe(true);
    expect(store.calls.count).toBe(calls);
  });
});
