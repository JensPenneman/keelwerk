import { describe, expect, test } from 'vitest';
import { fieldDescriptor } from '../../test/authorization/fixtures.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import { reactionPayloadOf } from './reaction-payload-of.ts';

const entry = {
  ref: 'auth.credential',
  module: 'auth',
  name: 'credential',
  origin: { note: 'audit', badge: 'audit' },
  events: {
    rotated: shape({ label: field.string(), reason: field.string().hidden() }),
    plain: null,
  },
  descriptor: {
    fields: {
      label: fieldDescriptor('string'),
      passwordHash: fieldDescriptor('verifier'),
      internal: fieldDescriptor('string', { hidden: true }),
      note: fieldDescriptor('string', { hidden: true }),
      badge: fieldDescriptor('string'),
      apiSecret: fieldDescriptor('secret'),
    },
  } as unknown as EntityDescriptor,
} as unknown as EntityEntry;

const values = {
  label: 'laptop',
  passwordHash: 'h',
  internal: 'i',
  note: 'n',
  badge: 'gold',
  apiSecret: 's',
};
const created = { values };
const before = { label: 'old', internal: 'older', note: 'older note', apiSecret: 'older' };
const changed = {
  set: { label: 'l', internal: 'i', note: 'n' },
  inc: { badge: 1, passwordHash: 2 },
  add: { apiSecret: ['a'], label: ['b'] },
  remove: { internal: ['r'], label: ['c'] },
  crdt: { note: { codec: 'x', update: 'u' } },
};
const payload = (name: string, data: unknown, authority: string, was: unknown = null) =>
  reactionPayloadOf(entry, name, data, was, authority);

describe('what a reaction receives of an event', () => {
  test('the owning module sees every member of its own, and not the fields another module contributed', () => {
    expect(payload('created', created, 'auth', before)).toEqual({
      data: { values: { label: 'laptop', passwordHash: 'h', internal: 'i', apiSecret: 's' } },
      before: { label: 'old', internal: 'older', apiSecret: 'older' },
    });
  });

  test('another module loses a hidden field, a hidden field with history in before, a secret and a verifier', () => {
    const seen = payload('created', created, 'accounts', before);
    expect(seen.data).toEqual({ values: { label: 'laptop' } });
    expect(seen.before).toEqual({ label: 'old' });
  });

  test("the contributor keeps its own contributed hidden field and not the owner's", () => {
    const seen = payload('imported', created, 'audit', before);
    expect(seen.data).toEqual({ values: { label: 'laptop', note: 'n', badge: 'gold' } });
    expect(seen.before).toEqual({ label: 'old', note: 'older note' });
  });

  test('every operation map of changed is filtered', () => {
    expect(payload('changed', changed, 'accounts').data).toEqual({
      set: { label: 'l' },
      inc: {},
      add: { label: ['b'] },
      remove: { label: ['c'] },
      crdt: {},
    });
    expect(payload('changed', changed, 'auth').data).toEqual({
      set: { label: 'l', internal: 'i' },
      inc: { passwordHash: 2 },
      add: { apiSecret: ['a'], label: ['b'] },
      remove: { internal: ['r'], label: ['c'] },
      crdt: {},
    });
  });

  test('a hidden member of a domain event reaches only the module of the entity', () => {
    const data = { label: 'l', reason: 'stolen' };
    expect(payload('rotated', data, 'accounts').data).toEqual({ label: 'l' });
    expect(payload('rotated', data, 'auth').data).toEqual(data);
    expect(payload('plain', { any: 1 }, 'accounts').data).toEqual({ any: 1 });
    expect(payload('archived', {}, 'accounts').data).toEqual({});
  });

  test("a stored member that is no field of the current descriptor reaches the entity's own module only", () => {
    // An old event's hidden member, or a member of a module no longer composed, is gone from the descriptor.
    const stored = { values: { label: 'laptop', retired: 'old hidden', gone: 'x' } };
    const was = { label: 'old', retired: 'older' };
    expect(payload('created', stored, 'accounts', was)).toEqual({
      data: { values: { label: 'laptop' } },
      before: { label: 'old' },
    });
    expect(payload('created', stored, 'audit', was).data).toEqual({ values: { label: 'laptop' } });
    expect(payload('created', stored, 'auth', was)).toEqual({ data: stored, before: was });
    expect(payload('changed', { set: { retired: 'r', label: 'l' } }, 'accounts').data).toEqual({
      set: { label: 'l' },
    });
    expect(payload('changed', { set: { retired: 'r' } }, 'auth').data).toEqual({
      set: { retired: 'r' },
    });
  });

  test("a member of a domain event that its schema no longer names reaches the entity's own module only", () => {
    const data = { label: 'l', reason: 'stolen', retired: 'old hidden' };
    expect(payload('rotated', data, 'accounts').data).toEqual({ label: 'l' });
    expect(payload('rotated', data, 'auth').data).toEqual(data);
  });

  test('an event of a stream that is no entity passes through unchanged', () => {
    const data = { values: { internal: 'i' } };
    expect(reactionPayloadOf(undefined, 'created', data, { internal: 'x' }, 'accounts')).toEqual({
      data,
      before: { internal: 'x' },
    });
  });
});
