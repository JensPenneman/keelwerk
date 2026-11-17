import { describe, expect, test } from 'vitest';
import { neverCondition } from '../authorization/never-condition.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { effectStatusSourceOf } from './effect-status-source-of.ts';
import { planLiveSource } from './plan-live-source.ts';

const ids = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, index) => `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`,
  );

const coreOwner = {
  action: { ref: 'core.effectStatusWatch', module: 'core' },
  registry: { effects: new Map() },
};

function refusal(run: () => unknown): KeelwerkError {
  try {
    run();
  } catch (error) {
    if (error instanceof KeelwerkError) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

describe('effectStatusSourceOf', () => {
  test('no id or more than 100 ids is a validation error', () => {
    for (const list of [[], ids(101)]) {
      const error = refusal(() => effectStatusSourceOf(list));
      expect(error.kind).toBe('validation');
      expect(error.message).toBe('The status watch follows 1 to 100 effects.');
    }
    expect(effectStatusSourceOf(ids(100))).toMatchObject({ kind: 'liveSource' });
  });

  test('repeated ids are followed once', () => {
    const [first = '', second = ''] = ids(2);
    expect(effectStatusSourceOf([first, second, first, first])).toEqual({
      kind: 'liveSource',
      source: { kind: 'effectStatus', ids: [first, second] },
    });
    expect(() => effectStatusSourceOf(Array.from({ length: 150 }, () => first))).not.toThrow();
  });

  test('planLiveSource answers a plan whose where is never until the setup sets it', () => {
    const [first = ''] = ids(1);
    const plan = planLiveSource(effectStatusSourceOf([first]), coreOwner);
    expect(plan).toEqual({
      kind: 'effectStatus',
      entity: 'core.effect',
      input: { ids: [first], from: 'beginning' },
      where: neverCondition,
      after: undefined,
      maps: [],
    });
  });
});
