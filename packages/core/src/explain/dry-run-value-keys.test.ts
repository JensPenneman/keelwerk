import { describe, expect, test } from 'vitest';
import type { SubjectKeyStore } from '../storage/subject-key-store.ts';
import { dryRunValueKeys } from './dry-run-value-keys.ts';

const binding = { entity: 'core.principal', id: 'p1', field: 'request' };
const text = (value: string) => new TextEncoder().encode(value);

/**
 * A store whose only key is the stored value key `principal:stored`; it refuses to seal. It
 * imitates the stored named value keys of the adapters (`liveValueKeys`); the conformance case
 * `namedValueKeyCases` (packages/testing/src/conformance/adapter/named-value-key-cases.ts) proves
 * that behaviour.
 */
const inner = {
  dataKey: () => Promise.resolve(undefined),
  sealValue: () => Promise.reject(new Error('a dry run never seals in the real store')),
  openValue: () => Promise.resolve(undefined),
  liveValueKeys: (keyIds: readonly string[]) =>
    Promise.resolve(keyIds.filter((keyId) => keyId === 'principal:stored')),
  destroyValueKey: () => Promise.resolve(),
} as unknown as SubjectKeyStore;

describe('dryRunValueKeys', () => {
  test('a named key is created in memory on first use and seals every value of the run', async () => {
    const keys = dryRunValueKeys()(inner);
    const first = await keys.sealValue(binding, text('one'), { keyId: 'principal:p1' });
    const second = await keys.sealValue(binding, text('two'), { keyId: 'principal:p1' });
    expect([first.keyId, second.keyId]).toEqual(['principal:p1', 'principal:p1']);
    expect(await keys.openValue(first, binding)).toEqual(text('one'));
    expect(await keys.openValue(second, binding)).toEqual(text('two'));
  });

  test('a live key is a held one or a stored one, in the order asked', async () => {
    const keys = dryRunValueKeys()(inner);
    await keys.sealValue(binding, text('one'), { keyId: 'principal:p1' });
    expect(
      await keys.liveValueKeys(['principal:none', 'principal:stored', 'principal:p1']),
    ).toEqual(['principal:stored', 'principal:p1']);
    await keys.destroyValueKey('principal:p1');
    expect(await keys.liveValueKeys(['principal:p1'])).toEqual([]);
  });
});
