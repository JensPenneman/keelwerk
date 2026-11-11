import { type ApiSurface, versionProjection } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { checkGraphqlSurface } from '../src/check/check-graphql-surface.ts';
import {
  ask,
  findAction,
  mountedGraphql,
  surfaceWithAction,
  transportSurface,
} from './support/graphql-kit.ts';

const respond = () => ({ ok: true as const, value: undefined });

/** The subjects the check lists under nameCollision, each once. */
function collidingSubjects(surface: ApiSurface): string[] {
  return [
    ...new Set(
      checkGraphqlSurface(surface)
        .filter((problem) => problem.code === 'nameCollision')
        .map((problem) => problem.subject),
    ),
  ].sort();
}

describe('the GraphQL surface check', () => {
  test('the transport fixture app has no problem', () => {
    expect(checkGraphqlSurface(transportSurface())).toEqual([]);
  });

  test('a custom input that is not a shape is refused at mount (S-153)', async () => {
    const surface = surfaceWithAction(
      transportSurface(),
      { input: { kind: 'string', optional: false, access: 'read-write' } },
      'loans.lend',
    );
    expect(checkGraphqlSurface(surface)).toMatchObject([
      { code: 'unsupportedShape', transport: 'graphql', subject: 'loans.lend' },
    ]);
    await expect(mountedGraphql(surface, respond)).rejects.toThrow(
      /^unsupportedShape: loans\.lend: .*\(API version 2026-11-04\)$/,
    );
  });

  test('two actions with one field name are a name collision naming graphql.field', () => {
    const surface = transportSurface();
    const about = findAction(surface, 'loans.about');
    const twin = {
      ...about,
      ref: 'loans.aboutAgain',
      name: 'aboutAgain',
      hints: { graphql: { field: 'loansAbout' } },
    };
    const problems = checkGraphqlSurface({ ...surface, actions: [...surface.actions, twin] });
    const collisions = problems.filter((problem) => problem.code === 'nameCollision');
    expect([...new Set(collisions.map((problem) => problem.subject))].sort()).toEqual([
      'loans.about',
      'loans.aboutAgain',
    ]);
    expect(collisions[0]?.message).toContain('hints.graphql.field');
  });

  test('a command input member named commandId is reserved', () => {
    const surface = transportSurface();
    const lend = findAction(surface, 'loans.lend');
    if (lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const input = {
      ...lend.input,
      fields: { ...lend.input.fields, commandId: lend.input.fields.bookTitle },
    };
    expect(checkGraphqlSurface(surfaceWithAction(surface, { input }, 'loans.lend'))).toMatchObject([
      { code: 'reservedName', subject: 'loans.lend' },
    ]);
  });

  test('an entity whose name an enum field of another entity takes is a name collision', async () => {
    const surface = transportSurface();
    const loan = surface.entities.find((candidate) => candidate.ref === 'loans.loan');
    if (loan === undefined) throw new Error('fixture changed');
    const clash = { ...loan, ref: 'loans.loanState', prefix: 'loanstate' };
    await expect(
      mountedGraphql({ ...surface, entities: [...surface.entities, clash] }, respond),
    ).rejects.toThrow(/^nameCollision: .*LoansLoanState/);
    expect(collidingSubjects({ ...surface, entities: [...surface.entities, clash] })).toEqual([
      'loans.loan',
      'loans.loanState',
    ]);
  });

  test('a nested member type that another command takes by name is a name collision', async () => {
    const surface = transportSurface();
    const lend = findAction(surface, 'loans.lend');
    if (lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const { fields } = lend.input;
    const member = (name: string) => ({
      kind: 'shape',
      optional: true,
      access: 'read-write',
      fields: { [name]: fields.bookTitle },
    });
    const nested = {
      ...lend.input,
      fields: { ...fields, x: member('a') },
    };
    const twin = {
      ...lend,
      ref: 'loans.lendX',
      name: 'lendX',
      input: member('b'),
    };
    const clashing = {
      ...surfaceWithAction(surface, { input: nested }, 'loans.lend'),
      actions: [...surfaceWithAction(surface, { input: nested }, 'loans.lend').actions, twin],
    };
    await expect(mountedGraphql(clashing as never, respond)).rejects.toThrow(
      /^nameCollision: .*LoansLendXInput/,
    );
    expect(collidingSubjects(clashing as never)).toEqual(['loans.lend', 'loans.lendX']);
  });

  test('nested members that differ only in optionality are a name collision', async () => {
    const surface = transportSurface();
    const lend = findAction(surface, 'loans.lend');
    if (lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const { fields } = lend.input;
    const shapeWith = (optional: boolean) => ({
      kind: 'shape',
      optional: true,
      access: 'read-write',
      fields: { a: { ...fields.bookTitle, optional } },
    });
    const nested = { ...lend.input, fields: { ...fields, x: shapeWith(false) } };
    const twin = { ...lend, ref: 'loans.lendX', name: 'lendX', input: shapeWith(true) };
    const withNested = surfaceWithAction(surface, { input: nested }, 'loans.lend');
    const clashing = { ...withNested, actions: [...withNested.actions, twin] };
    await expect(mountedGraphql(clashing as never, respond)).rejects.toThrow(/^nameCollision: /);
    expect(collidingSubjects(clashing as never)).toEqual(['loans.lend', 'loans.lendX']);
  });

  test('a hidden get leaves the scalar beside a reference alone', async () => {
    const surface = transportSurface();
    const loan = surface.entities.find((candidate) => candidate.ref === 'loans.loan');
    const title = loan?.fields.bookTitle;
    if (title === undefined) throw new Error('fixture changed');
    const hidden = surfaceWithAction(
      {
        ...surface,
        entities: surface.entities.map((entity) =>
          entity.ref === 'loans.loan'
            ? { ...entity, fields: { ...entity.fields, book: title } }
            : entity,
        ),
      },
      { hints: { graphql: { expose: false } } },
      'library.book.get',
    );
    expect(checkGraphqlSurface(hidden)).toEqual([]);
    const { handler } = await mountedGraphql(hidden, respond);
    const answer = await ask(
      handler,
      '{ __type(name: "LoansLoan") { fields { name type { name } } } }',
      undefined,
    );
    const book = answer.body.data.__type.fields.find(
      (field: { name: string }) => field.name === 'book',
    );
    expect(book.type.name).toBe('String');
  });

  test('an unknown declared error code is refused', () => {
    const surface = surfaceWithAction(transportSurface(), { errors: ['loans.nope'] }, 'loans.lend');
    expect(checkGraphqlSurface(surface)).toMatchObject([
      { code: 'unknownError', subject: 'loans.lend' },
    ]);
  });

  test('an older version the check refuses fails the mount', async () => {
    const good = transportSurface();
    const bad = surfaceWithAction(
      { ...good, apiVersion: '2026-11-11' },
      { input: { kind: 'string', optional: false, access: 'read-write' } },
      'loans.lend',
    );
    const surfaces = versionProjection(['2026-11-04', '2026-11-11'], (version) =>
      version === '2026-11-11' ? bad : good,
    );
    await expect(mountedGraphql(good, respond, { surfaces })).rejects.toThrow(
      /unsupportedShape: loans\.lend: .*\(API version 2026-11-11\)$/,
    );
  });
});
