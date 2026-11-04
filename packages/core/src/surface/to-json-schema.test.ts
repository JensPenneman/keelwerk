import { describe, expect, test } from 'vitest';
import { nodeOf } from '../../test/field-node-kit.ts';
import { field } from '../fields/field.ts';
import type { AnyField } from '../fields/field-def.ts';
import { shape } from '../fields/shape.ts';
import type { FieldNode } from './field-node.ts';
import { toJsonSchema } from './to-json-schema.ts';

const kinds: Readonly<Record<string, AnyField>> = {
  plainInteger: field.integer(),
  json: field.json({
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => ({ type: 'string' }), output: () => ({ type: 'number' }) },
    },
  }),
  shape: field.json(
    shape({
      title: field.string(),
      serial: field.serial(),
      password: field.secret(),
      note: field.string().optional(),
      masked: field.string().maskable(),
    }),
  ),
  string: field.string({ minLength: 1, maxLength: 80, pattern: '^[a-z]+$', format: 'email' }),
  text: field.text(),
  integer: field.integer({ min: 0, max: 10 }),
  wideInteger: field.integer({ wide: true }),
  decimal: field.decimal({ precision: 10, scale: 2 }),
  float: field.float(),
  serial: field.serial(),
  boolean: field.boolean(),
  instant: field.instant(),
  date: field.date(),
  timeZone: field.timeZone(),
  enum: field.enum(['open', 'closed']),
  ref: field.ref.own('book'),
  list: field.list(field.string()),
  set: field.set(field.integer()),
  binary: field.binary(),
  secret: field.secret(),
  richText: field.richText(),
  blob: field.blob({ maxBytes: 10 }),
  subject: field.subject(),
};

const base = { optional: false, access: 'read-write' } as const;
const string: FieldNode = { ...base, kind: 'string' };
const direct: Readonly<Record<string, FieldNode>> = {
  page: { ...base, kind: 'page', item: string },
  foreign: {
    ...base,
    kind: 'foreign',
    input: { type: 'string' },
    output: { type: 'number' },
  },
  void: { ...base, kind: 'void' },
  id: { ...base, kind: 'id', target: 'library.book', prefix: 'book' },
};

describe('toJsonSchema, one snapshot per kind and direction', () => {
  for (const direction of ['input', 'output'] as const) {
    for (const [name, def] of Object.entries(kinds)) {
      test(`${direction} ${name}`, () => {
        expect(toJsonSchema(nodeOf(def), { direction })).toMatchSnapshot();
      });
    }
    for (const [name, node] of Object.entries(direct)) {
      test(`${direction} ${name}`, () => {
        expect(toJsonSchema(node, { direction })).toMatchSnapshot();
      });
    }
  }
});

describe('toJsonSchema, projections', () => {
  test('a shape lists required members and leaves out read-only ones on input', () => {
    const node = nodeOf(
      field.json(
        shape({
          title: field.string(),
          note: field.string().optional(),
          state: field.enum(['a', 'b']).default('a'),
          password: field.secret(),
        }),
      ),
    );
    const input = toJsonSchema(node);
    expect(input.required).toEqual(['title', 'password']);
    expect(input.additionalProperties).toBe(false);
    const output = toJsonSchema(node, { direction: 'output' });
    expect(output.required).toEqual(['title', 'state']);
    expect(Object.keys(output.properties as object)).toEqual(['title', 'note', 'state']);
  });

  test('the TypeID pattern accepts ids of the prefix and nothing else', () => {
    const schema = toJsonSchema(nodeOf(field.ref.own('book')));
    const pattern = new RegExp(String(schema.pattern), 'u');
    expect(pattern.test('book_01j9zx8f6qe5m9c7y2d3a4b5c6')).toBe(true);
    expect(pattern.test('shelf_01j9zx8f6qe5m9c7y2d3a4b5c6')).toBe(false);
    expect(pattern.test('book_81j9zx8f6qe5m9c7y2d3a4b5c6')).toBe(false);
  });

  test('descriptions, defaults and deprecation are carried', () => {
    const schema = toJsonSchema(
      nodeOf(field.integer({ wide: true }).default(5n).describe('Copies').deprecated('x')),
    );
    expect(schema).toMatchObject({ description: 'Copies', default: '5', deprecated: true });
  });

  test('the decimal and wide integer patterns match the wire forms', () => {
    const decimal = new RegExp(
      String(toJsonSchema(nodeOf(field.decimal({ precision: 9, scale: 2 }))).pattern),
    );
    expect(['12.50', '-3', '0.001'].every((text) => decimal.test(text))).toBe(true);
    expect(['1.', 'x'].some((text) => decimal.test(text))).toBe(false);
  });

  test('a serial is not required on input, a maskable member not on output', () => {
    const node = nodeOf(
      field.json(shape({ n: field.serial(), t: field.string(), m: field.string().maskable() })),
    );
    expect(toJsonSchema(node).required).toEqual(['t', 'm']);
    expect(toJsonSchema(node, { direction: 'output' }).required).toEqual(['n', 't']);
  });

  test('a plain integer is bounded to the safe integers', () => {
    expect(toJsonSchema(nodeOf(field.integer()))).toMatchObject({
      minimum: -9007199254740991,
      maximum: 9007199254740991,
    });
  });

  test('rich text input also takes a value without a version', () => {
    const schema = toJsonSchema(nodeOf(field.richText()));
    expect(JSON.stringify(schema.anyOf)).toContain('"required":["codec","text","delta"]');
  });
});
