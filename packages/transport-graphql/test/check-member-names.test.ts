import { describe, expect, test } from 'vitest';
import { checkGraphqlSurface } from '../src/check/check-graphql-surface.ts';
import {
  findAction,
  mountedGraphql,
  surfaceWithAction,
  transportSurface,
} from './support/graphql-kit.ts';

const respond = () => ({ ok: true as const, value: undefined });

describe('a member name that would make an invalid type name', () => {
  test('an enum or shape member that is no GraphQL name is reported, never a crash', async () => {
    const surface = transportSurface();
    const lend = findAction(surface, 'loans.lend');
    if (lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const { fields } = lend.input;
    const members = [
      ['a b', { kind: 'enum', values: ['x', 'y'], optional: true, access: 'read-write' }],
      ['é', { kind: 'enum', values: ['x', 'y'], optional: true, access: 'read-write' }],
      [
        'a$b',
        {
          kind: 'shape',
          fields: { inner: fields.bookTitle },
          optional: true,
          access: 'read-write',
        },
      ],
    ] as const;
    for (const [name, node] of members) {
      const changed = surfaceWithAction(
        surface,
        { input: { ...lend.input, fields: { ...fields, [name]: node } } },
        'loans.lend',
      );
      expect(checkGraphqlSurface(changed), name).toMatchObject([
        { code: 'unsupportedShape', subject: 'loans.lend' },
      ]);
      await expect(mountedGraphql(changed, respond), name).rejects.toThrow(
        /^unsupportedShape: loans\.lend: /,
      );
    }
  });

  test('an enum or shape member of a query action that is no GraphQL name is reported, never a crash', async () => {
    const surface = transportSurface();
    const find = findAction(surface, 'library.findByIsbn');
    if (find.input.kind !== 'shape') throw new Error('findByIsbn takes a shape');
    const { fields } = find.input;
    const [first] = Object.values(fields);
    if (first === undefined) throw new Error('findByIsbn has a member');
    const members = [
      ['a b', { kind: 'enum', values: ['x', 'y'], optional: true, access: 'read-write' }],
      ['a$b', { kind: 'shape', fields: { inner: first }, optional: true, access: 'read-write' }],
    ] as const;
    for (const [name, node] of members) {
      const changed = surfaceWithAction(
        surface,
        { input: { ...find.input, fields: { ...fields, [name]: node } } },
        'library.findByIsbn',
      );
      expect(checkGraphqlSurface(changed), name).toMatchObject([
        { code: 'unsupportedShape', subject: 'library.findByIsbn' },
      ]);
      await expect(mountedGraphql(changed, respond), name).rejects.toThrow(
        /^unsupportedShape: library\.findByIsbn: /,
      );
    }
  });

  test('an enum member of error data that is no GraphQL name is reported, never a crash', () => {
    const surface = transportSurface();
    const error = surface.errors.find((candidate) => candidate.code === 'loans.already_lent');
    if (error?.data?.kind !== 'shape') throw new Error('fixture changed');
    const data = {
      ...error.data,
      fields: {
        ...error.data.fields,
        'a b': { kind: 'enum', values: ['x', 'y'], optional: true, access: 'read-write' },
      },
    };
    const changed = {
      ...surface,
      errors: surface.errors.map((candidate) =>
        candidate.code === 'loans.already_lent' ? { ...candidate, data } : candidate,
      ),
    };
    expect(checkGraphqlSurface(changed as never)).toMatchObject([
      { code: 'unsupportedShape', subject: 'loans.already_lent' },
    ]);
  });

  test('an entity field that is no GraphQL name is reported, never a crash', () => {
    const surface = transportSurface();
    const entity = surface.entities.find((candidate) => candidate.ref === 'library.book');
    if (entity === undefined) throw new Error('fixture changed');
    const changed = {
      ...surface,
      entities: surface.entities.map((candidate) =>
        candidate === entity
          ? {
              ...candidate,
              fields: {
                ...candidate.fields,
                'a b': { kind: 'string', optional: true, access: 'read-write' },
              },
            }
          : candidate,
      ),
    };
    expect(() => checkGraphqlSurface(changed as never)).not.toThrow();
    expect(checkGraphqlSurface(changed as never)).toMatchObject([
      { code: 'unsupportedShape', subject: 'library.book' },
    ]);
  });
});
