import { describe, expect, it } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { memoryScopeKeys } from '../../test/keys/memory-scope-keys.ts';
import { createKeyService } from './create-key-service.ts';
import { destroyedOrWrong } from './destroyed-or-wrong.ts';
import { issueSecret } from './issue-secret.ts';

const master = { version: 3, material: new Uint8Array(32).fill(9) };
const tenant = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
const clock = { now: () => Temporal.Instant.from('2026-11-05T10:00:00Z') };

describe('destroyedOrWrong', () => {
  it('answers match, wrong and destroyed', async () => {
    const key = new Uint8Array(32).fill(5);
    const issued = issueSecret(key, { prefix: 'pss' }, countingRandomSource());
    expect(destroyedOrWrong(key, issued.plain, issued.verifier)).toBe('match');
    expect(destroyedOrWrong(new Uint8Array(32).fill(6), issued.plain, issued.verifier)).toBe(
      'wrong',
    );
    expect(destroyedOrWrong(key, 'garbage', issued.verifier)).toBe('wrong');
    expect(destroyedOrWrong(undefined, issued.plain, issued.verifier)).toBe('destroyed');
  });
});

describe('verify and verifyOutcome of the key service', () => {
  it('verify is false for a wrong secret and for a destroyed key, verifyOutcome tells them apart', async () => {
    const store = memoryScopeKeys();
    const service = createKeyService({
      master: {
        current: async () => master,
        byVersion: async (v) => (v === 3 ? master : undefined),
      },
      deploymentId: 'dep',
      withScopeKeys: store.withScopeKeys,
      clock,
      random: countingRandomSource(),
    });
    const issued = await service.issue(tenant, { prefix: 'pss' });
    expect(await service.verifyOutcome(tenant, issued.plain, issued.verifier)).toBe('match');
    expect(await service.verify(tenant, issued.plain, issued.verifier)).toBe(true);
    expect(await service.verifyOutcome(tenant, issued.plain, 'x'.repeat(52))).toBe('wrong');
    expect(await service.verify(tenant, issued.plain, 'x'.repeat(52))).toBe(false);
    await store.withScopeKeys((keys) => keys.destroy('t1'));
    service.invalidate(tenant);
    expect(await service.verifyOutcome(tenant, issued.plain, issued.verifier)).toBe('destroyed');
    expect(await service.verify(tenant, issued.plain, issued.verifier)).toBe(false);
  });
});
