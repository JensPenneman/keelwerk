import type { ApiSurface } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { checkGraphqlSurface } from '../src/check/check-graphql-surface.ts';
import {
  findAction,
  mountedGraphql,
  surfaceWithAction,
  transportSurface,
} from './support/graphql-kit.ts';

const respond = () => ({ ok: true as const, value: undefined });

describe('the names the GraphQL schema makes', () => {
  /** The fixture's `loans.lend` with a `kind` enum member of these values. */
  function lendWithEnum(values: readonly string[]): ApiSurface {
    const surface = transportSurface();
    const lend = findAction(surface, 'loans.lend');
    if (lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const input = {
      ...lend.input,
      fields: {
        ...lend.input.fields,
        kind: { kind: 'enum', values, optional: true, access: 'read-write' },
      },
    };
    return surfaceWithAction(surface, { input }, 'loans.lend');
  }

  test('two enum values with one GraphQL name are a name collision', async () => {
    const surface = lendWithEnum(['a-b', 'a_b']);
    const problems = checkGraphqlSurface(surface);
    expect(problems).toMatchObject([
      { code: 'nameCollision', transport: 'graphql', subject: 'loans.lend' },
    ]);
    expect(problems[0]?.message).toMatch(/'a-b' and 'a_b'.*'LoansLendKind'.*A_B/);
    await expect(mountedGraphql(surface, respond)).rejects.toThrow(/^nameCollision: loans\.lend: /);
  });

  test('an enum value whose name starts with two underscores is reserved', async () => {
    const surface = lendWithEnum(['__x']);
    expect(checkGraphqlSurface(surface)).toMatchObject([
      { code: 'reservedName', subject: 'loans.lend' },
    ]);
    await expect(mountedGraphql(surface, respond)).rejects.toThrow(/^reservedName: loans\.lend: /);
  });

  test('an enum value that is no GraphQL name is unsupported', () => {
    for (const values of [[''], ['2fa']]) {
      const refused = checkGraphqlSurface(lendWithEnum(values));
      expect(refused, JSON.stringify(values)).toMatchObject([
        { code: 'unsupportedShape', subject: 'loans.lend' },
      ]);
      expect(refused[0]?.message).toContain('Rename the value');
    }
  });

  test('a value with a character a name cannot hold, and true, are named and pass', () => {
    // `shared-tables` of the core's placement is SHARED_TABLES, `true` is TRUE and `inProgress` IN_PROGRESS.
    for (const values of [['shared-tables'], ['true', 'false', 'null'], ['inProgress', 'done']]) {
      expect(checkGraphqlSurface(lendWithEnum(values)), JSON.stringify(values)).toEqual([]);
    }
  });

  test('an enum in error data is checked', () => {
    const surface = transportSurface();
    const lend = findAction(surface, 'loans.lend');
    const error = surface.errors.find((candidate) => candidate.code === 'loans.already_lent');
    if (error?.data?.kind !== 'shape' || lend.input.kind !== 'shape') {
      throw new Error('fixture changed');
    }
    const data = {
      ...error.data,
      fields: {
        ...error.data.fields,
        kind: { kind: 'enum', values: ['a-b', 'a_b'], optional: true, access: 'read-write' },
      },
    };
    const changed = {
      ...surface,
      errors: surface.errors.map((candidate) =>
        candidate.code === 'loans.already_lent' ? { ...candidate, data } : candidate,
      ),
    };
    expect(checkGraphqlSurface(changed as never)).toMatchObject([
      { code: 'nameCollision', subject: 'loans.already_lent' },
    ]);
  });

  test('an enum in an update patch is reported once, under the type the schema uses', () => {
    const surface = transportSurface();
    const update = findAction(surface, 'library.book.update');
    if (update.input.kind !== 'shape') throw new Error('update takes a shape');
    const patch = update.input.fields.patch;
    if (patch?.kind !== 'shape') throw new Error('update has a patch');
    const input = {
      ...update.input,
      fields: {
        ...update.input.fields,
        patch: {
          ...patch,
          fields: {
            ...patch.fields,
            kind: { kind: 'enum', values: ['a-b', 'a_b'], optional: true, access: 'read-write' },
          },
        },
      },
    };
    const problems = checkGraphqlSurface(
      surfaceWithAction(surface, { input }, 'library.book.update'),
    );
    expect(problems).toMatchObject([{ code: 'nameCollision', subject: 'library.book.update' }]);
    expect(problems[0]?.message).toContain('LibraryBookKind');
  });

  test('a member name that is no GraphQL name is unsupported', () => {
    const surface = transportSurface();
    const lend = findAction(surface, 'loans.lend');
    if (lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const { fields } = lend.input;
    const withMember = (name: string) =>
      surfaceWithAction(
        surface,
        { input: { ...lend.input, fields: { ...fields, [name]: fields.bookTitle } } },
        'loans.lend',
      );
    expect(checkGraphqlSurface(withMember('2x'))).toMatchObject([
      { code: 'unsupportedShape', subject: 'loans.lend' },
    ]);
    expect(checkGraphqlSurface(withMember('a-b'))).toMatchObject([
      { code: 'unsupportedShape', subject: 'loans.lend' },
    ]);
    expect(checkGraphqlSurface(withMember('__x'))).toMatchObject([
      { code: 'reservedName', subject: 'loans.lend' },
    ]);
  });

  test('a type name from a hint that is no GraphQL name is unsupported, never a crash', async () => {
    const surface = transportSurface();
    for (const hints of [
      { graphql: { field: '2x' } },
      { graphql: { type: '2Lend' } },
      { graphql: { type: 'Loans-Lend' } },
    ]) {
      const changed = surfaceWithAction(surface, { hints }, 'loans.lend');
      const problems = checkGraphqlSurface(changed);
      expect(problems, JSON.stringify(hints)).toMatchObject([
        { code: 'unsupportedShape', subject: 'loans.lend' },
      ]);
      expect(problems[0]?.message).toMatch(/hints\.graphql\.type, or hints\.graphql\.field/);
      await expect(mountedGraphql(changed, respond)).rejects.toThrow(
        /^unsupportedShape: loans\.lend: /,
      );
    }
  });

  test('two reference fields whose objects take one name are a collision', async () => {
    const surface = transportSurface();
    const loan = surface.entities.find((candidate) => candidate.ref === 'loans.loan');
    const book = loan?.fields.bookId;
    if (loan === undefined || book === undefined) throw new Error('fixture changed');
    const changed = {
      ...surface,
      entities: surface.entities.map((entity) =>
        entity === loan
          ? { ...entity, fields: { ...entity.fields, relatedTo: book, relatedToBookId: book } }
          : entity,
      ),
    };
    const problems = checkGraphqlSurface(changed);
    expect(problems).toMatchObject([{ code: 'nameCollision', subject: 'loans.loan' }]);
    expect(problems[0]?.message).toMatch(
      /'relatedToBook'.*reference object of 'relatedTo' of loans\.loan and reference object of 'relatedToBookId' of loans\.loan/,
    );
    await expect(mountedGraphql(changed, respond)).rejects.toThrow(/^nameCollision: loans\.loan: /);
  });

  test('every collision is reported in a stable order', () => {
    const base = lendWithEnum(['a-b', 'a_b']);
    const about = findAction(base, 'loans.about');
    const twin = {
      ...about,
      ref: 'loans.aboutAgain',
      name: 'aboutAgain',
      hints: { graphql: { field: 'loansAbout' } },
    };
    const surface = { ...base, actions: [...base.actions, twin] };
    const problems = checkGraphqlSurface(surface);
    expect([...new Set(problems.map((problem) => problem.subject))]).toEqual([
      'loans.about',
      'loans.aboutAgain',
      'loans.lend',
    ]);
    const reversed = {
      ...surface,
      entities: [...surface.entities].reverse(),
      actions: [...surface.actions].reverse(),
      errors: [...surface.errors].reverse(),
    };
    expect(checkGraphqlSurface(reversed)).toEqual(problems);
  });

  test('a nested type that takes the name of a fixed type is a collision, never a crash', async () => {
    const surface = transportSurface();
    const lend = findAction(surface, 'loans.lend');
    if (lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const input = {
      ...lend.input,
      fields: {
        ...lend.input.fields,
        direction: { kind: 'enum', values: ['up', 'down'], optional: true, access: 'read-write' },
      },
    };
    for (const hints of [
      { graphql: { type: 'Sort' } },
      { graphql: { type: 'Sort', field: 'sort' } },
    ]) {
      const clashing = surfaceWithAction(surface, { input, hints }, 'loans.lend');
      const problems = checkGraphqlSurface(clashing);
      expect(problems).toMatchObject([{ code: 'nameCollision', subject: 'loans.lend' }]);
      expect(problems[0]?.message).toMatch(/'SortDirection' is taken by .*the fixed types/);
      await expect(mountedGraphql(clashing, respond)).rejects.toThrow(
        /^nameCollision: loans\.lend: /,
      );
    }
  });

  test('a type that only the second asker would build is checked whichever asker comes first', () => {
    const surface = transportSurface();
    const lend = findAction(surface, 'loans.lend');
    if (lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const { fields } = lend.input;
    const withMember = (name: string, member: unknown) => ({
      kind: 'shape',
      optional: true,
      access: 'read-write',
      fields: { [name]: member },
    });
    const nested = {
      ...lend.input,
      fields: {
        ...fields,
        xY: withMember('j', {
          kind: 'enum',
          values: ['a-b', 'a_b'],
          optional: true,
          access: 'read-write',
        }),
      },
    };
    const twin = {
      ...lend,
      ref: 'loans.lendX',
      name: 'lendX',
      input: { ...lend.input, fields: { y: withMember('k', fields.bookTitle) } },
    };
    const base = surfaceWithAction(surface, { input: nested }, 'loans.lend');
    const clashing = { ...base, actions: [...base.actions, twin] } as never as ApiSurface;
    const problems = checkGraphqlSurface(clashing);
    expect(problems.map((problem) => `${problem.code} ${problem.subject}`)).toEqual([
      'nameCollision loans.lend',
      'nameCollision loans.lend',
      'nameCollision loans.lendX',
    ]);
    expect(problems.map((problem) => problem.message).join('\n')).toMatch(/LoansLendXYJ/);
    const reversed = { ...clashing, actions: [...clashing.actions].reverse() };
    expect(checkGraphqlSurface(reversed)).toEqual(problems);
  });
});
