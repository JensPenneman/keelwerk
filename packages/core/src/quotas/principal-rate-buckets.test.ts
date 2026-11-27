import { describe, expect, test } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { memoryScopeKeys } from '../../test/keys/memory-scope-keys.ts';
import { bucketKey } from '../admission/bucket-key.ts';
import { createKeyService } from '../keys/create-key-service.ts';
import { subjectSpellings } from '../subjects/subject-spellings.ts';
import { principalRateBuckets } from './principal-rate-buckets.ts';

const master = { version: 1, material: new Uint8Array(32).fill(9) };
const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
const clock = { now: () => Temporal.Instant.from('2026-11-26T10:00:00Z') };
const keys = createKeyService({
  master: { current: async () => master, byVersion: async () => master },
  deploymentId: 'dep',
  withScopeKeys: memoryScopeKeys().withScopeKeys,
  clock,
  random: countingRandomSource(),
});

const subject = '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e71';
const spellings = [
  '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e71',
  '0198a2c47e107a3b8c5d3f2a1b9d4e71',
  '0198A2C4-7E10-7A3B-8C5D-3F2A1B9D4E71',
  '0198A2C47E107A3B8C5D3F2A1B9D4E71',
];

describe('the request-rate buckets that principals own', () => {
  test('a subject is named as a user and as a service in each spelling the kernel knows', async () => {
    expect(subjectSpellings(subject)).toEqual(spellings);
    const names = await principalRateBuckets(keys, scope, spellings);
    const expected = await Promise.all(
      spellings.flatMap((spelling) =>
        ['user', 'service'].map((kind) =>
          bucketKey(keys, scope, 'core', `core.principalRequestRate:${kind}:${spelling}`),
        ),
      ),
    );
    expect(new Set(names)).toEqual(new Set(expected));
    expect(new Set(names).size).toBe(spellings.length * 2);
  });
});
