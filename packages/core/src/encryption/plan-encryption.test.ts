import { describe, expect, test } from 'vitest';
import type { Condition } from '../conditions/condition.ts';
import { deriveFieldKey } from '../keys/derive-field-key.ts';
import type { DerivedIndexField } from '../storage/derived-index-field.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { eqTag } from './eq-tag.ts';
import { normalizerRegistry } from './normalizer-registry.ts';
import { planEncryption } from './plan-encryption.ts';
import type { SealingContext } from './sealing-context.ts';

const root = new Uint8Array(32).fill(9);

function field(kind: FieldDescriptor['kind'], column: string, over: Partial<FieldDescriptor> = {}) {
  const base: FieldDescriptor = {
    kind,
    column,
    optional: true,
    unique: false,
    indexed: false,
    hidden: false,
    maskable: false,
    stateOnly: false,
    sealed: false,
    merge: 'lww',
    personal: false,
    constraints: {},
    ref: null,
    inner: null,
    codec: null,
    tag: 1,
  };
  return { ...base, ...over };
}

const personal = (
  queries: readonly ('eq' | 'prefix')[],
  normalize: string,
  bits = 128,
): FieldDescriptor['personal'] => ({
  subject: 'id',
  queries,
  normalize: { id: normalize, version: 1 },
  params: {
    eq: { bits },
    prefix: { min: 3, max: 32 },
    contains: { bits: 12 },
    order: { bytes: 16 },
  },
  keys: 'tenant',
});

const derived = (column: string, name: string, query: 'eq' | 'prefix'): DerivedIndexField => ({
  field: name,
  kind: query === 'eq' ? 'binary' : 'tagSet',
  query,
  column,
  keyVersion: 1,
  unicode: '16.0',
});

const entity = (over: Record<string, FieldDescriptor> = {}): EntityDescriptor => ({
  ref: 'app.person',
  module: 'app',
  name: 'person',
  history: 'chain',
  tenancy: 'tenant',
  shape: { id: 'app.person@1', tracks: {} },
  dataSubject: 'id',
  table: 'app__person',
  fields: {
    email: field('string', 'email', { personal: personal(['eq', 'prefix'], 'email') }),
    nick: field('string', 'nick', { personal: personal(['eq'], 'caseless', 32) }),
    note: field('string', 'note', { personal: personal([], 'nfc') }),
    name: field('string', 'name'),
    ...over,
  },
  relations: {},
  indexes: [],
  partition: null,
  mergeState: false,
  searchIndexes: [],
  derivedIndexes: Object.fromEntries(
    [
      derived('email__eq', 'email', 'eq'),
      derived('email__prefix', 'email', 'prefix'),
      derived('nick__eq', 'nick', 'eq'),
    ].map((index) => [index.column, index]),
  ),
  external: null,
});

const context: SealingContext = {
  unit: undefined as never,
  describe: () => undefined,
  normalizers: normalizerRegistry(),
  indexKeys: {
    fieldKey: async (_entity, name, declaration, index) =>
      deriveFieldKey(root, {
        entity: 'app.person',
        field: name,
        capability: index.query,
        normaliser: `${declaration.normalize.id}@1`,
        parameters: index.query === 'eq' ? { bits: declaration.params.eq.bits } : undefined,
      }),
  },
  random: (bytes) => new Uint8Array(bytes),
  maxScan: 100,
  dataKey: async () => ({ id: 'k', material: root }),
  keyById: async () => undefined,
};

const tagOf = (name: string, normalised: string, bits = 128): Uint8Array =>
  eqTag(
    deriveFieldKey(root, {
      entity: 'app.person',
      field: name,
      capability: 'eq',
      normaliser: `${name === 'email' ? 'email' : 'caseless'}@1`,
      parameters: { bits },
    }),
    normalised,
    bits,
  );

const plan = (condition: Condition) => planEncryption(context, entity(), condition);

describe('the encryption planner (14.7.9.5)', () => {
  test('eq, ne, in and nin move onto the equality tag of the normalised operand', async () => {
    const tag = tagOf('email', 'jens@jenspenneman.com');
    expect(
      (await plan({ op: 'eq', field: 'email', value: 'Jens@JensPenneman.com' })).condition,
    ).toEqual({
      op: 'eq',
      field: 'email__eq',
      value: tag,
    });
    expect(
      (await plan({ op: 'ne', field: 'email', value: 'jens@jenspenneman.com' })).condition,
    ).toEqual({
      op: 'ne',
      field: 'email__eq',
      value: tag,
    });
    expect(
      (await plan({ op: 'in', field: 'email', value: ['JENS@jenspenneman.com'] })).condition,
    ).toEqual({ op: 'in', field: 'email__eq', value: [tag] });
    expect(
      (await plan({ op: 'nin', field: 'email', value: ['jens@jenspenneman.com'] })).condition,
    ).toEqual({ op: 'nin', field: 'email__eq', value: [tag] });
    expect((await plan({ op: 'eq', field: 'email', value: 'x@y.z' })).verify).toBe(true);
  });

  test('isNull stays on the sealed column and plain fields are untouched', async () => {
    const same: Condition = {
      op: 'and',
      conditions: [
        { op: 'isNull', field: 'email', value: true },
        { op: 'eq', field: 'name', value: 'Ada' },
        { op: 'isNull', field: 'note', value: false },
      ],
    };
    const planned = await plan(same);
    expect(planned.condition).toEqual(same);
    expect(planned.verify).toBe(false);
  });

  test('a prefix becomes a presence test and the bounded scan of S-37', async () => {
    const planned = await plan({ op: 'startsWith', field: 'email', value: 'Jen' });
    expect(planned.condition).toEqual({ op: 'isNull', field: 'email', value: false });
    expect(planned).toMatchObject({ scan: true, verify: true });
  });

  test('a prefix in an or is still a positive position; under not it is refused', async () => {
    const inOr = await plan({
      op: 'or',
      conditions: [
        { op: 'startsWith', field: 'email', value: 'abc' },
        { op: 'eq', field: 'name', value: 'x' },
      ],
    });
    expect(inOr.scan).toBe(true);
    await expect(
      plan({ op: 'not', condition: { op: 'startsWith', field: 'email', value: 'abc' } }),
    ).rejects.toMatchObject({ code: 'core.personal_operator' });
  });

  test('a prefix shorter than the minimum is core.personal_needle_short', async () => {
    await expect(plan({ op: 'startsWith', field: 'email', value: 'Je' })).rejects.toMatchObject({
      code: 'core.personal_needle_short',
    });
  });

  test('what a field does not declare is core.personal_operator', async () => {
    for (const condition of [
      { op: 'eq', field: 'note', value: 'x' },
      { op: 'startsWith', field: 'nick', value: 'abc' },
      { op: 'contains', field: 'email', value: 'abc' },
      { op: 'lt', field: 'email', value: 'abc' },
      { op: 'gte', field: 'nick', value: 'abc' },
    ] satisfies Condition[]) {
      await expect(plan(condition)).rejects.toMatchObject({
        kind: 'unsupported',
        code: 'core.personal_operator',
      });
    }
  });

  test('a truncated tag answers a positive eq and marks the plan approximate', async () => {
    const planned = await plan({ op: 'eq', field: 'nick', value: 'ADA' });
    expect(planned.approximate).toBe(true);
    expect(planned.condition).toEqual({
      op: 'eq',
      field: 'nick__eq',
      value: tagOf('nick', 'ada', 32),
    });
    expect((planned.condition as { value: Uint8Array }).value).toHaveLength(4);
    for (const condition of [
      { op: 'ne', field: 'nick', value: 'ada' },
      { op: 'nin', field: 'nick', value: ['ada'] },
      { op: 'not', condition: { op: 'eq', field: 'nick', value: 'ada' } },
    ] satisfies Condition[]) {
      await expect(plan(condition)).rejects.toMatchObject({ code: 'core.personal_operator' });
    }
  });

  test('a relation quantifier is planned against the related entity and must stay exact', async () => {
    const owner: EntityDescriptor = {
      ...entity(),
      ref: 'app.owner',
      relations: {
        people: {
          kind: 'many',
          target: 'app.person',
          by: 'ownerId',
          to: 'id',
          contributedBy: null,
        },
      },
    };
    const withRelations: SealingContext = {
      ...context,
      describe: (ref) => (ref === 'app.person' ? entity() : undefined),
    };
    const tag = tagOf('email', 'ada@example.org');
    const planned = await planEncryption(withRelations, owner, {
      op: 'some',
      relation: 'people',
      where: { op: 'eq', field: 'email', value: 'ADA@example.org' },
    });
    expect(planned.condition).toEqual({
      op: 'some',
      relation: 'people',
      where: { op: 'eq', field: 'email__eq', value: tag },
    });
    // The database evaluates the quantifier, so the kernel cannot verify it afterwards.
    expect(planned.verify).toBe(false);
    for (const where of [
      { op: 'startsWith', field: 'email', value: 'abc' },
      { op: 'eq', field: 'nick', value: 'ada' },
    ] satisfies Condition[]) {
      await expect(
        planEncryption(withRelations, owner, { op: 'none', relation: 'people', where }),
      ).rejects.toMatchObject({ code: 'core.personal_operator' });
    }
  });

  test('an operand of the wrong type is a validation error, never a silent miss', async () => {
    await expect(plan({ op: 'eq', field: 'email', value: 5 })).rejects.toMatchObject({
      kind: 'validation',
    });
    await expect(plan({ op: 'in', field: 'email', value: 'x' })).rejects.toMatchObject({
      kind: 'validation',
    });
  });
});
