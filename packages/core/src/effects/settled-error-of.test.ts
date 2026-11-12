import { expect, test } from 'vitest';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import { settledErrorOf } from './settled-error-of.ts';

const entry = { ref: 'dispatch.ship', module: 'dispatch' } as unknown as EffectEntry;
const registry = {
  actions: new Map<string, ActionEntry>([
    [
      'dispatch.report',
      {
        module: 'dispatch',
        errors: ['dispatch.parcel_lost'],
        errorSpecs: { 'dispatch.parcel_lost': { kind: 'not_found', message: 'Lost.' } },
      } as unknown as ActionEntry,
    ],
    [
      'other.report',
      {
        module: 'other',
        errors: ['other.stolen'],
        errorSpecs: { 'other.stolen': { kind: 'forbidden', message: 'Stolen.' } },
      } as unknown as ActionEntry,
    ],
  ]),
};

test('a core code keeps its kind', () => {
  expect(settledErrorOf(registry, entry, { code: 'core.forbidden' })).toMatchObject({
    kind: 'forbidden',
    code: 'core.forbidden',
    retryable: false,
  });
});

test('a code only the kernel stores is core.internal', () => {
  for (const code of [
    'core.effect_deadline',
    'core.effect_outcome_unknown',
    'core.job_lease_lost',
    'core.key_destroyed',
  ]) {
    expect(settledErrorOf(registry, entry, { code })).toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      retryable: false,
    });
  }
});

test('a declared code keeps its declared kind', () => {
  expect(settledErrorOf(registry, entry, { code: 'dispatch.parcel_lost' })).toMatchObject({
    kind: 'not_found',
    code: 'dispatch.parcel_lost',
    retryable: false,
  });
});

test('any other code is core.internal', () => {
  for (const code of ['other.stolen', 'dispatch.unknown', 'ada@example.org', 'constructor']) {
    expect(settledErrorOf(registry, entry, { code })).toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      retryable: false,
    });
  }
});

test('no message is kept', () => {
  const stored = settledErrorOf(registry, entry, {
    code: 'dispatch.parcel_lost',
    message: 'parcel for ada@example.org lost',
  } as { readonly code: string });
  expect(Object.keys(stored).sort()).toEqual(['code', 'kind', 'requestId', 'retryable']);
  expect(JSON.stringify(stored)).not.toContain('ada@example.org');
});
