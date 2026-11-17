import type { ApiSurface } from '@keelwerk/core';
import { GraphQLObjectType, getNamedType, printSchema } from 'graphql';
import { describe, expect, test } from 'vitest';
import { checkGraphqlSurface } from '../src/check/check-graphql-surface.ts';
import { buildGraphqlSchema } from '../src/schema/build-graphql-schema.ts';
import {
  findAction,
  mountedGraphql,
  surfaceWithAction,
  transportSurface,
} from './support/graphql-kit.ts';

const respond = () => ({ ok: true as const, value: undefined });

describe('the enum types an action hint names', () => {
  /** `loans.lend` and `loans.about` with an output shape of one `state` member and an enum hint. */
  function withEnumHints(
    first: { values: readonly string[]; hints: unknown; member?: Record<string, unknown> },
    second: { values: readonly string[]; hints: unknown },
  ): ApiSurface {
    const surface = transportSurface();
    const template = findAction(surface, 'loans.lend').input;
    if (template.kind !== 'shape') throw new Error('lend takes a shape');
    const outputOf = (values: readonly string[], member: Record<string, unknown> | undefined) => ({
      ...template,
      fields: {
        state: { kind: 'enum', values, optional: true, access: 'read-write' },
        ...member,
      },
    });
    const one = surfaceWithAction(
      surface,
      { output: outputOf(first.values, first.member), hints: first.hints },
      'loans.lend',
    );
    return surfaceWithAction(
      one,
      { output: outputOf(second.values, undefined), hints: second.hints },
      'loans.about',
    );
  }

  const stateHint = { graphql: { enums: { state: 'LoanState' } } };

  test('an enum hint names the enum type of a top-level output member, and two fields with the same values share it', () => {
    const changed = withEnumHints(
      { values: ['open', 'closed'], hints: stateHint },
      { values: ['open', 'closed'], hints: stateHint },
    );
    expect(checkGraphqlSurface(changed)).toEqual([]);
    const { schema } = buildGraphqlSchema(changed);
    const state = schema.getType('LoanState');
    expect(state).toBeDefined();
    expect(printSchema(schema).match(/enum LoanState/g)).toHaveLength(1);
    const printed = printSchema(schema);
    expect(printed.match(/\bstate: LoanState\b/g)).toHaveLength(2);
    const typed = Object.values(schema.getTypeMap()).filter(
      (type) =>
        type instanceof GraphQLObjectType &&
        !type.name.startsWith('__') &&
        type.getFields().state !== undefined &&
        getNamedType(type.getFields().state?.type as never) === state,
    );
    expect(typed).toHaveLength(2);
  });

  test('an enum hint that names an enum of other values is a name collision', () => {
    const changed = withEnumHints(
      { values: ['open', 'closed'], hints: stateHint },
      { values: ['open', 'lost'], hints: stateHint },
    );
    const problems = checkGraphqlSurface(changed);
    expect(problems).toMatchObject([{ code: 'nameCollision' }, { code: 'nameCollision' }]);
    for (const problem of problems) expect(problem.message).toContain("'LoanState'");
  });

  test('an enum hint on a member that is no enum of the output is unsupported, never a crash', async () => {
    for (const member of [
      { title: { kind: 'string', optional: true, access: 'read-write' } },
      {},
    ]) {
      const hints = { graphql: { enums: { title: 'LoanTitle' } } };
      const changed = withEnumHints(
        { values: ['open'], hints, member },
        { values: ['open'], hints: {} },
      );
      expect(checkGraphqlSurface(changed)).toMatchObject([
        { code: 'unsupportedShape', subject: 'loans.lend' },
      ]);
      await expect(mountedGraphql(changed, respond)).rejects.toThrow(
        /^unsupportedShape: loans\.lend: /,
      );
    }
  });

  test('an enum hint whose name is no GraphQL name is unsupported, never a crash', async () => {
    for (const name of ['2x', '__X']) {
      const hints = { graphql: { enums: { state: name } } };
      const changed = withEnumHints({ values: ['open'], hints }, { values: ['open'], hints: {} });
      const problems = checkGraphqlSurface(changed);
      expect(problems, name).toMatchObject([{ code: 'unsupportedShape', subject: 'loans.lend' }]);
      expect(problems[0]?.message).toContain(`'${name}'`);
      await expect(mountedGraphql(changed, respond)).rejects.toThrow(
        /^unsupportedShape: loans\.lend: /,
      );
    }
  });
  test('an enum hint on a write-only member is unsupported, never accepted and dropped', async () => {
    const hints = { graphql: { enums: { state: 'LoanState' } } };
    const member = { state: { kind: 'enum', values: ['open'], optional: true, access: 'write' } };
    const changed = withEnumHints(
      { values: ['open'], hints, member },
      { values: ['open'], hints: {} },
    );
    expect(checkGraphqlSurface(changed)).toMatchObject([
      { code: 'unsupportedShape', subject: 'loans.lend' },
    ]);
    await expect(mountedGraphql(changed, respond)).rejects.toThrow(
      /^unsupportedShape: loans\.lend: /,
    );
  });

  test('an enum hint on an action the schema answers with its entity type is unsupported', async () => {
    const hints = { graphql: { enums: { state: 'BookState' } } };
    const surface = transportSurface();
    const template = findAction(surface, 'loans.lend').input;
    if (template.kind !== 'shape') throw new Error('lend takes a shape');
    const output = {
      ...template,
      fields: { state: { kind: 'enum', values: ['open'], optional: true, access: 'read-write' } },
    };
    for (const ref of ['library.book.create', 'library.book.get']) {
      const changed = surfaceWithAction(surface, { output, hints }, ref);
      expect(checkGraphqlSurface(changed), ref).toMatchObject([
        { code: 'unsupportedShape', subject: ref },
      ]);
      await expect(mountedGraphql(changed, respond)).rejects.toThrow(
        new RegExp(`^unsupportedShape: ${ref.replaceAll('.', '\\.')}: `),
      );
    }
  });

  test('an enum hint named after a fixed type is a reserved name, also where the schema lacks that root', () => {
    const hintsOf = (name: string) => ({ graphql: { enums: { state: name } } });
    for (const name of ['Subscription', 'StreamHead', 'StreamResetReason', 'Query']) {
      const full = withEnumHints(
        { values: ['open'], hints: hintsOf(name) },
        { values: ['open'], hints: {} },
      );
      const changed = { ...full, actions: full.actions.filter((a) => a.kind !== 'subscription') };
      const problems = checkGraphqlSurface(changed);
      expect(problems, name).toMatchObject([{ code: 'reservedName', subject: 'loans.lend' }]);
      expect(problems[0]?.message).toContain(`'${name}'`);
    }
  });

  test('two actions that share an output type name but differ in the enum hint collide, whichever is built first', () => {
    const surface = transportSurface();
    const template = findAction(surface, 'loans.lend').input;
    if (template.kind !== 'shape') throw new Error('lend takes a shape');
    const output = {
      ...template,
      fields: {
        state: { kind: 'enum', values: ['open', 'closed'], optional: true, access: 'read-write' },
      },
    };
    const hinted = { graphql: { type: 'Shared', enums: { state: 'LoanState' } } };
    const plain = { graphql: { type: 'Shared' } };
    for (const [aboutHints, isbnHints] of [
      [hinted, plain],
      [plain, hinted],
    ]) {
      const one = surfaceWithAction(surface, { output, hints: aboutHints }, 'loans.about');
      const changed = surfaceWithAction(one, { output, hints: isbnHints }, 'library.findByIsbn');
      const problems = checkGraphqlSurface(changed);
      expect(problems).toMatchObject([{ code: 'nameCollision' }, { code: 'nameCollision' }]);
      for (const problem of problems) expect(problem.message).toContain("'SharedOutput'");
    }
    // A hint that only spells out the default enum name builds the same type: no collision.
    const spelled = { graphql: { type: 'Shared', enums: { state: 'SharedOutputState' } } };
    for (const [aboutHints, isbnHints] of [
      [spelled, plain],
      [plain, spelled],
    ]) {
      const one = surfaceWithAction(surface, { output, hints: aboutHints }, 'loans.about');
      const changed = surfaceWithAction(one, { output, hints: isbnHints }, 'library.findByIsbn');
      expect(checkGraphqlSurface(changed)).toEqual([]);
    }
    // An entry the check refuses (a write-only member, a member that is not there) names no type:
    // the two actions still share the type, and only the refusal is reported.
    const writeOnly = {
      ...template,
      fields: {
        ...template.fields,
        state: { kind: 'enum', values: ['open'], optional: true, access: 'write' },
      },
    };
    for (const enums of [{ state: 'SharedState' }, { nope: 'SharedNope' }]) {
      const refused = { graphql: { type: 'Shared', enums } };
      for (const [aboutHints, isbnHints, subject] of [
        [refused, plain, 'loans.about'],
        [plain, refused, 'library.findByIsbn'],
      ] as const) {
        const one = surfaceWithAction(
          surface,
          { output: writeOnly, hints: aboutHints },
          'loans.about',
        );
        const changed = surfaceWithAction(
          one,
          { output: writeOnly, hints: isbnHints },
          'library.findByIsbn',
        );
        expect(checkGraphqlSurface(changed)).toMatchObject([{ code: 'unsupportedShape', subject }]);
      }
    }
  });
});
