import { describe, expect, it } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { memoryScopeKeys } from '../../test/keys/memory-scope-keys.ts';
import { jobKeyInfo } from '../effects/job-key-info.ts';
import { fingerprintKeyInfo } from '../write-path/fingerprint-key-info.ts';
import { createKeyService } from './create-key-service.ts';
import { deriveScopeSecrets } from './derive-scope-secrets.ts';

const master = { version: 3, material: new Uint8Array(32).fill(9) };
const tenant = { level: 'tenant', backendId: 'b1', tenantId: 't-fresh' } as const;

describe('the secrets of a scope, taken before its unit opens', () => {
  it('creates the key of a fresh scope once and answers the secrets a later derivation gives', async () => {
    const store = memoryScopeKeys();
    const service = createKeyService({
      master: { current: async () => master, byVersion: async () => master },
      deploymentId: 'dep',
      withScopeKeys: store.withScopeKeys,
      clock: { now: () => Temporal.Instant.from('2026-11-05T10:00:00Z') },
      random: countingRandomSource(),
    });
    const secrets = await deriveScopeSecrets(service, tenant);
    expect(store.rows).toHaveLength(1);
    expect(secrets.jobKey).toHaveLength(32);
    expect(secrets.fingerprintKey).toHaveLength(32);
    expect(secrets.jobKey).not.toEqual(secrets.fingerprintKey);
    expect(await service.derive(tenant, jobKeyInfo, 32)).toEqual(secrets.jobKey);
    expect(await service.derive(tenant, fingerprintKeyInfo, 32)).toEqual(secrets.fingerprintKey);
    expect(store.rows).toHaveLength(1);
  });
});
