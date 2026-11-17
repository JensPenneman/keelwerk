import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import { effectStatusSourceOf } from './effect-status-source-of.ts';
import { planLiveSource } from './plan-live-source.ts';

const ids = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, index) => `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`,
  );

const ship = {
  ref: 'dispatch.ship',
  module: 'dispatch',
  name: 'ship',
  performer: 'external',
  executor: null,
  input: shape({
    parcel: field.string(),
    recipient: field.string().personal({ subject: 'parcel' }),
  }),
  output: shape({}),
  dataSubject: 'parcel',
} as unknown as EffectEntry;
const post = { ...ship, ref: 'dispatch.post', name: 'post', performer: 'executor' } as EffectEntry;
const foreign = { ...ship, ref: 'other.ship', module: 'other' } as EffectEntry;
const registry = {
  effects: new Map([
    ['dispatch.ship', ship],
    ['dispatch.post', post],
    ['other.ship', foreign],
  ]),
};
const core = { action: { ref: 'core.effectStatusWatch', module: 'core' }, registry };
const rogue = { action: { ref: 'rogue.forged', module: 'rogue' }, registry };
const dispatch = { action: { ref: 'dispatch.pending', module: 'dispatch' }, registry };

const statusLeaf = (list: unknown) => ({
  kind: 'liveSource',
  source: { kind: 'effectStatus', ids: list },
});
const effectsLeaf = (over: Record<string, unknown> = {}) => ({
  kind: 'liveSource',
  source: { kind: 'effects', effect: 'dispatch.ship', plain: ['parcel'], entry: ship, ...over },
});

function refusedKind(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return String((error as { kind?: unknown }).kind);
  }
  return 'planned';
}

describe('planLiveSource owners', () => {
  test('a status leaf is planned only for core.effectStatusWatch', () => {
    const leaf = effectStatusSourceOf(ids(2));
    expect(planLiveSource(leaf, core)).toMatchObject({ kind: 'effectStatus' });
    expect(refusedKind(() => planLiveSource(leaf, rogue))).toBe('internal');
    expect(refusedKind(() => planLiveSource(leaf, dispatch))).toBe('internal');
  });

  test('a status leaf of no id, of more than 100 distinct ids or of non-strings is refused, also from core', () => {
    for (const list of [[], ids(101), ids(10_000), [1, 2], 'abc', undefined]) {
      expect(refusedKind(() => planLiveSource(statusLeaf(list), core))).toBe('internal');
    }
    const first = ids(1)[0];
    const plan = planLiveSource(statusLeaf([first, first, ...ids(3)]), core);
    expect(plan).toMatchObject({ input: { ids: ids(3) } });
    expect(planLiveSource(statusLeaf(ids(100)), core)).toMatchObject({ kind: 'effectStatus' });
  });

  test('an effects leaf is planned only for an action of the module that owns an external effect', () => {
    expect(planLiveSource(effectsLeaf(), dispatch)).toMatchObject({ kind: 'effects' });
    expect(refusedKind(() => planLiveSource(effectsLeaf(), rogue))).toBe('internal');
    expect(
      refusedKind(() =>
        planLiveSource(effectsLeaf({ effect: 'other.ship', entry: foreign }), dispatch),
      ),
    ).toBe('internal');
    expect(
      refusedKind(() => planLiveSource(effectsLeaf({ effect: 'dispatch.none' }), dispatch)),
    ).toBe('internal');
    expect(
      refusedKind(() =>
        planLiveSource(effectsLeaf({ effect: 'dispatch.post', entry: post }), dispatch),
      ),
    ).toBe('internal');
  });

  test('a contributed action answers for its contributor, not for the module it is mounted under', () => {
    const contributedBy = (by: string, ref = 'dispatch.peek', module = 'dispatch') => ({
      action: { ref, module, contributedBy: by },
      registry,
    });
    // `rogue` contributes a subscription to `dispatch`: the code is rogue's, so it owns no effect of dispatch.
    expect(refusedKind(() => planLiveSource(effectsLeaf(), contributedBy('rogue')))).toBe(
      'internal',
    );
    // `dispatch` contributes to another module: the code is dispatch's, so it owns its effect.
    expect(
      planLiveSource(effectsLeaf(), contributedBy('dispatch', 'rogue.peek', 'rogue')),
    ).toMatchObject({ kind: 'effects', effect: 'dispatch.ship' });
    expect(
      refusedKind(() =>
        planLiveSource(
          statusLeaf(ids(2)),
          contributedBy('rogue', 'core.effectStatusWatch', 'core'),
        ),
      ),
    ).toBe('internal');
  });

  test('the effects plan takes effect, plain and entry from the registry, never from the leaf', () => {
    const plan = planLiveSource(
      effectsLeaf({ plain: ['parcel', 'recipient'], entry: { forged: true } }),
      dispatch,
    );
    expect(plan).toMatchObject({ kind: 'effects', effect: 'dispatch.ship', plain: ['parcel'] });
    expect((plan as { entry: unknown }).entry).toBe(ship);
  });
});
