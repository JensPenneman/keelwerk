import { describe, expect, test } from 'vitest';
import { nodeOf } from '../../test/field-node-kit.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { fieldNodeOf } from './field-node-of.ts';

describe('fieldNodeOf', () => {
  test('carries kind, constraints and the tag', () => {
    expect(nodeOf(field.string({ maxLength: 40, format: 'email' }), 3)).toEqual({
      kind: 'string',
      optional: false,
      access: 'read-write',
      tag: 3,
      maxLength: 40,
      format: 'email',
    });
    expect(nodeOf(field.integer({ wide: true, min: 0 }))).toMatchObject({
      kind: 'integer',
      wide: true,
      min: 0,
    });
    expect(nodeOf(field.serial({ per: 'shelf' }))).toMatchObject({
      kind: 'serial',
      per: ['shelf'],
    });
  });

  test('a declared tag wins over the allocated one', () => {
    expect(nodeOf(field.string().tag(9), 2).tag).toBe(9);
  });

  test('flags and documentation reach the node', () => {
    const node = nodeOf(
      field
        .string()
        .optional()
        .unique()
        .maskable()
        .personal()
        .describe('The title')
        .deprecated('use name'),
    );
    expect(node).toMatchObject({
      optional: true,
      unique: true,
      maskable: true,
      personal: true,
      merge: 'exclusive',
      description: 'The title',
      deprecated: { reason: 'use name' },
    });
  });

  test('a secret is write-only and the context may mark a field read-only', () => {
    expect(nodeOf(field.secret()).access).toBe('write');
    expect(
      fieldNodeOf(field.serial(), { declaredBy: 'm', tag: 1, prefixOf: () => 'x', access: 'read' })
        .access,
    ).toBe('read');
  });

  test('references resolve their prefix through the context', () => {
    const node = fieldNodeOf(field.ref.own('book'), {
      declaredBy: 'library',
      tag: 1,
      prefixOf: (ref) => (ref === 'library.book' ? 'bk' : undefined),
    });
    expect(node).toMatchObject({ kind: 'ref', target: 'library.book', prefix: 'bk' });
    expect(() =>
      fieldNodeOf(field.ref.own('gone'), {
        declaredBy: 'library',
        tag: 1,
        prefixOf: () => undefined,
      }),
    ).toThrow(TypeError);
  });

  test('lists nest their item without a tag and shapes tag their members in order', () => {
    expect(nodeOf(field.list(field.string()))).toMatchObject({
      kind: 'list',
      item: { kind: 'string' },
    });
    expect(nodeOf(field.list(field.string()))).not.toHaveProperty('item.tag');
    const node = nodeOf(
      field.json(shape({ a: field.string(), b: field.string().tag(1), c: field.boolean() })),
    );
    expect(node).toMatchObject({ kind: 'shape' });
    expect('fields' in node && Object.values(node.fields).map((member) => member.tag)).toEqual([
      2, 1, 3,
    ]);
  });

  test('a json field takes the output schema of its Standard JSON Schema, or is refused', () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (value: unknown) => ({ value }),
        jsonSchema: { input: () => ({ type: 'string' }), output: () => ({ type: 'number' }) },
      },
    };
    expect(nodeOf(field.json(schema))).toMatchObject({ kind: 'json', schema: { type: 'number' } });
    expect(() =>
      nodeOf(
        field.json({
          '~standard': { version: 1 as const, vendor: 'test', validate: () => ({ value: 1 }) },
        }),
      ),
    ).toThrow(TypeError);
  });

  test('a verifier never appears in the surface', () => {
    expect(() => nodeOf(field.verifier())).toThrow(TypeError);
  });

  test('a serial is read-only', () => {
    expect(nodeOf(field.serial()).access).toBe('read');
  });

  test('shape members that are hidden or verifiers leave the surface, tags stay by position', () => {
    const node = nodeOf(
      field.json(
        shape({
          a: field.string(),
          secretish: field.verifier(),
          h: field.string().hidden(),
          c: field.boolean(),
        }),
      ),
    );
    expect('fields' in node && Object.keys(node.fields)).toEqual(['a', 'c']);
    expect('fields' in node && Object.values(node.fields).map((member) => member.tag)).toEqual([
      1, 4,
    ]);
  });
});
