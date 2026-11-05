import { describe, expect, test } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { memoryScopeKeys } from '../../test/keys/memory-scope-keys.ts';
import { createKeyService } from './create-key-service.ts';
import { isForkable } from './is-forkable.ts';

const master = { version: 1, material: new Uint8Array(32).fill(9) };
const tenant = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
const clock = { now: () => Temporal.Instant.from('2026-11-05T10:00:00Z') };

function setup() {
  const store = memoryScopeKeys();
  const service = createKeyService({
    master: { current: async () => master, byVersion: async () => master },
    deploymentId: 'dep',
    withScopeKeys: store.withScopeKeys,
    clock,
    random: countingRandomSource(),
  });
  return { service, store };
}

describe('a forked key service (the dry run)', () => {
  test('creates scope keys in memory only and uses the real keys that exist', async () => {
    const { service, store } = setup();
    expect(isForkable(service)).toBe(true);
    const forked = service.fork();
    const issued = await forked.issue(tenant, { prefix: 'pss' });
    expect(store.rows).toHaveLength(0);
    expect(await forked.verify(tenant, issued.plain, issued.verifier)).toBe(true);
    expect(await service.verify(tenant, issued.plain, issued.verifier)).toBe(false);

    const real = await service.issue(tenant, { prefix: 'pss' });
    expect(store.rows).toHaveLength(1);
    expect(await service.fork().verify(tenant, real.plain, real.verifier)).toBe(true);
  });
});
