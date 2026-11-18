import { describe, expect, test } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { memoryScopeKeys } from '../../test/keys/memory-scope-keys.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { createKeyService } from '../keys/create-key-service.ts';
import { isForkable } from '../keys/is-forkable.ts';
import { fingerprintKeyInfo } from '../write-path/fingerprint-key-info.ts';
import { dryRunFingerprintKey } from './dry-run-fingerprint-key.ts';
import { dryRunKeys } from './dry-run-keys.ts';

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
  // The same service without `fork`: a custom or test key service.
  const plain: KeyService = {
    issue: (scope, options) => service.issue(scope, options),
    derive: (scope, info, length, options) => service.derive(scope, info, length, options),
    verify: (scope, token, verifier) => service.verify(scope, token, verifier),
    verifyOutcome: (scope, token, verifier) => service.verifyOutcome(scope, token, verifier),
    reveal: (unit, ref, reason, expected) => service.reveal(unit, ref, reason, expected),
    invalidate: (scope) => {
      service.invalidate(scope);
    },
  };
  return { service, plain, store };
}

describe('the key of the digests of a dry run', () => {
  test('a key service that cannot fork gives the key of an existing scope key and creates nothing', async () => {
    const { service, plain, store } = setup();
    expect(isForkable(plain)).toBe(false);
    const real = await service.derive(tenant, fingerprintKeyInfo, 32);
    expect(store.rows).toHaveLength(1);
    const key = await dryRunFingerprintKey(plain, dryRunKeys(plain), tenant);
    expect(key).toEqual(real);
    expect(store.rows).toHaveLength(1);
  });

  test('a key service that cannot fork and a scope without a key give a random key of this run alone, and create no key', async () => {
    const { plain, store } = setup();
    const first = await dryRunFingerprintKey(plain, dryRunKeys(plain), tenant);
    const second = await dryRunFingerprintKey(plain, dryRunKeys(plain), tenant);
    expect(first).toHaveLength(32);
    expect(first).not.toEqual(second);
    expect(store.rows).toHaveLength(0);
  });

  test('a key service that forks and a scope with a key gives the real key', async () => {
    const { service, store } = setup();
    const real = await service.derive(tenant, fingerprintKeyInfo, 32);
    expect(store.rows).toHaveLength(1);
    const key = await dryRunFingerprintKey(service, service.fork(), tenant);
    expect(key).toEqual(real);
    expect(store.rows).toHaveLength(1);
  });

  test('a key service that forks derives from the fork and leaves the real store untouched', async () => {
    const { service, store } = setup();
    expect(isForkable(service)).toBe(true);
    const key = await dryRunFingerprintKey(service, service.fork(), tenant);
    expect(key).toHaveLength(32);
    expect(store.rows).toHaveLength(0);
  });
});
