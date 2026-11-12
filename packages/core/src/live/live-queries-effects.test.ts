import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { liveQueriesOf } from './live-queries-of.ts';

function effect(ref: string, performer: 'executor' | 'external'): EffectEntry {
  const [module = '', name = ''] = ref.split('.');
  return {
    ref,
    module,
    name,
    performer,
    executor: performer === 'executor' ? ref : null,
    input: shape({
      parcel: field.string(),
      depot: field.string(),
      recipient: field.string().personal({ subject: 'parcel' }),
      token: field.secret(),
      tags: field.list(field.string()),
    }),
    output: shape({}),
    dataSubject: 'parcel',
  };
}

const registry = {
  contributions: [],
  entities: new Map(),
  effects: new Map([
    ['dispatch.ship', effect('dispatch.ship', 'external')],
    ['dispatch.pack', effect('dispatch.pack', 'executor')],
    ['other.ship', effect('other.ship', 'external')],
  ]),
} as unknown as Registry;

const module = { id: 'dispatch', requires: [], optional: [] } as unknown as ModuleEntry;
const effects = (
  liveQueriesOf(registry, module) as unknown as {
    effects(effect: object, options?: object): unknown;
  }
).effects;

describe('ctx.live.effects at run time (15.4.11)', () => {
  test('an effect of another module is internal', () => {
    expect(() => effects({ ref: 'other.ship' })).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
    expect(() => effects({ ref: 'dispatch.unknown' })).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
  });

  test('an executor effect is internal', () => {
    expect(() => effects({ ref: 'dispatch.pack' })).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
  });

  test('a where over a member the input lacks is internal, and over a sealed member too, naming the member only', () => {
    expect(() => effects({ ref: 'dispatch.ship' }, { where: { weight: 3 } })).toThrow(
      expect.objectContaining({ kind: 'internal', message: expect.stringContaining('"weight"') }),
    );
    for (const where of [
      { recipient: 'ada@example.org' },
      { token: 'x' },
      { and: [{ depot: 'north' }, { not: { recipient: { startsWith: 'ada' } } }] },
    ]) {
      let caught: unknown;
      try {
        effects({ ref: 'dispatch.ship' }, { where });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ kind: 'internal' });
      expect((caught as Error).message).not.toContain('ada');
    }
  });

  test('the leaf carries the plain members and the normalised where', () => {
    expect(effects({ ref: 'dispatch.ship' }, { where: { depot: 'north' }, after: 'tok' })).toEqual({
      kind: 'liveSource',
      source: {
        kind: 'effects',
        effect: 'dispatch.ship',
        plain: ['parcel', 'depot', 'tags'],
        entry: registry.effects.get('dispatch.ship'),
        where: { op: 'eq', field: 'depot', value: 'north' },
        after: 'tok',
      },
    });
    expect(effects({ ref: 'dispatch.ship' })).toEqual({
      kind: 'liveSource',
      source: {
        kind: 'effects',
        effect: 'dispatch.ship',
        plain: ['parcel', 'depot', 'tags'],
        entry: registry.effects.get('dispatch.ship'),
      },
    });
  });
});
