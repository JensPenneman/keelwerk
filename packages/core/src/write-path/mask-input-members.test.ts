import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { maskInputMembers } from './mask-input-members.ts';

const marker = 'kw:withheld';
/** A schema that is no keelwerk shape. */
const anySchema = {
  '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
} as const;
const fields = {
  password: field.secret(),
  token: field.secret().optional(),
  tokens: field.list(field.secret()),
  keys: field.set(field.secret()),
  verifier: field.verifier(),
  email: field.string().personal(),
  emails: field.list(field.string().personal()),
  title: field.string(),
  settings: field.json(shape({ token: field.secret(), label: field.string() })),
  rows: field.list(field.json(shape({ token: field.secret(), label: field.string() }))),
  opaque: field.json(anySchema),
};

describe('maskInputMembers', () => {
  test('a value that is no plain object is answered as it is', () => {
    for (const value of [null, undefined, 'x', 3, ['a'], new Set(['a'])]) {
      expect(maskInputMembers(fields, value, 'credentials')).toBe(value);
    }
  });

  test('a secret and a verifier are withheld in both modes; the input is not changed', () => {
    const input = { password: 'hunter2', verifier: 'v', title: 'hello' };
    for (const mode of ['credentials', 'credentials-and-personal'] as const) {
      expect(maskInputMembers(fields, input, mode)).toEqual({
        password: marker,
        verifier: marker,
        title: 'hello',
      });
    }
    expect(input.password).toBe('hunter2');
  });

  test('an optional secret absent stays absent, present is withheld, null stays null', () => {
    expect(maskInputMembers(fields, {}, 'credentials')).toEqual({});
    expect(maskInputMembers(fields, { token: 'abc' }, 'credentials')).toEqual({ token: marker });
    expect(maskInputMembers(fields, { token: null }, 'credentials')).toEqual({ token: null });
    expect(maskInputMembers(fields, { token: undefined }, 'credentials')).toEqual({
      token: undefined,
    });
  });

  test('two values of one withheld member give the same answer', () => {
    expect(maskInputMembers(fields, { password: 'a' }, 'credentials')).toEqual(
      maskInputMembers(fields, { password: 'b' }, 'credentials'),
    );
  });

  test('a list or set of secrets is one marker whatever its length', () => {
    const one = maskInputMembers(
      fields,
      { tokens: ['a', 'b'], keys: new Set(['k']) },
      'credentials',
    );
    const other = maskInputMembers(
      fields,
      { tokens: ['c', 'd', 'e'], keys: new Set(['x', 'y']) },
      'credentials',
    );
    expect(one).toEqual({ tokens: marker, keys: marker });
    expect(other).toEqual(one);
  });

  test('a personal member is copied in credentials mode and withheld in the other', () => {
    const input = { email: 'ada@example.org', emails: ['a@x.org', 'b@x.org'], title: 't' };
    expect(maskInputMembers(fields, input, 'credentials')).toEqual(input);
    expect(maskInputMembers(fields, input, 'credentials-and-personal')).toEqual({
      email: marker,
      emails: marker,
      title: 't',
    });
  });

  test('a member that is a credential and personal is withheld in both modes', () => {
    const both = { code: field.secret().personal() };
    for (const mode of ['credentials', 'credentials-and-personal'] as const) {
      expect(maskInputMembers(both, { code: 'c' }, mode)).toEqual({ code: marker });
    }
  });

  test('a json member over a shape is walked with its fields', () => {
    const input = { settings: { token: 'abc', label: 'l' } };
    expect(maskInputMembers(fields, input, 'credentials')).toEqual({
      settings: { token: marker, label: 'l' },
    });
    expect(maskInputMembers(fields, { settings: 'not an object' }, 'credentials')).toEqual({
      settings: 'not an object',
    });
  });

  test('a list of json shapes is walked element by element; a null element stays', () => {
    const input = { rows: [{ token: 'a', label: 'x' }, null, { label: 'y' }] };
    expect(maskInputMembers(fields, input, 'credentials')).toEqual({
      rows: [{ token: marker, label: 'x' }, null, { label: 'y' }],
    });
  });

  test('a set of json shapes becomes a list', () => {
    const set = field.set(field.json(shape({ token: field.secret() })));
    expect(
      maskInputMembers({ rows: set }, { rows: new Set([{ token: 'a' }]) }, 'credentials'),
    ).toEqual({ rows: [{ token: marker }] });
  });

  test('a json member whose schema is no keelwerk shape is opaque', () => {
    expect(maskInputMembers(fields, { opaque: 'anything' }, 'credentials')).toEqual({
      opaque: 'anything',
    });
  });

  test('a member no field declares passes unchanged', () => {
    expect(maskInputMembers(fields, { extra: 'x', password: 'p' }, 'credentials')).toEqual({
      extra: 'x',
      password: marker,
    });
  });

  test('a withheld value is never read', () => {
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('read');
        },
      },
    );
    expect(() => maskInputMembers(fields, { password: trap }, 'credentials')).not.toThrow();
  });

  describe('over the fields of an entity (descriptors)', () => {
    const descriptor = (over: Partial<FieldDescriptor>): FieldDescriptor =>
      ({ kind: 'string', personal: false, sealed: false, inner: null, ...over }) as FieldDescriptor;
    const entity = {
      name: descriptor({}),
      email: descriptor({ personal: { subject: 'id' } as FieldDescriptor['personal'] }),
      password: descriptor({ kind: 'secret', sealed: true }),
      apiKey: descriptor({ kind: 'verifier', sealed: true }),
      phones: descriptor({
        kind: 'list',
        inner: descriptor({ personal: { subject: 'id' } as FieldDescriptor['personal'] }),
      }),
    };
    const item = { name: 'Ada', email: 'a@x.org', password: 'p', apiKey: 'k', phones: ['1'] };

    test('secret and verifier are withheld, personal only in the base mode', () => {
      expect(maskInputMembers(entity, item, 'credentials')).toEqual({
        name: 'Ada',
        email: 'a@x.org',
        password: marker,
        apiKey: marker,
        phones: ['1'],
      });
      expect(maskInputMembers(entity, item, 'credentials-and-personal')).toEqual({
        name: 'Ada',
        email: marker,
        password: marker,
        apiKey: marker,
        phones: marker,
      });
    });
  });
});
