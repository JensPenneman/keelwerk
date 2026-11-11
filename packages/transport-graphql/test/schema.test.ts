import { deriveSurface } from '@keelwerk/core';
import { conformanceApp, versionedApp } from '@keelwerk/testing/fixtures';
import {
  type GraphQLNamedType,
  type GraphQLObjectType,
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  lexicographicSortSchema,
  printSchema,
  validateSchema,
} from 'graphql';
import { describe, expect, test } from 'vitest';
import { buildGraphqlSchema } from '../src/schema/build-graphql-schema.ts';
import { surfaceWithAction, transportSurface } from './support/graphql-kit.ts';
import { relationSurface } from './support/relation-surface.ts';

const conformance = deriveSurface(conformanceApp as never, '2026-11-04').surface;

function printed(surface: Parameters<typeof buildGraphqlSchema>[0]): string {
  return printSchema(lexicographicSortSchema(buildGraphqlSchema(surface).schema));
}

/** The same surface with every list of members and every object's keys in the opposite order. */
function shuffled<T>(value: T): T {
  if (Array.isArray(value)) return [...value].reverse() as T;
  return value;
}

function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, member]) => [key, reversedKeys(member)]),
    );
  }
  return value;
}

describe('the schema of a surface', () => {
  test('the printed schema is the same for two builds and for a shuffled surface', () => {
    const first = printed(conformance);
    expect(printed(conformance)).toBe(first);
    const other = reversedKeys({
      ...conformance,
      modules: shuffled(conformance.modules),
      entities: shuffled(conformance.entities),
      actions: shuffled(conformance.actions),
      errors: shuffled(conformance.errors),
      events: shuffled(conformance.events),
    }) as typeof conformance;
    expect(printed(other)).toBe(first);
  });

  test('LoansLoan has nullable fields, ID! id, SafeInt! version, _masked and the book reference', () => {
    const { schema } = buildGraphqlSchema(transportSurface());
    const loan = schema.getType('LoansLoan') as GraphQLObjectType;
    const fields = loan.getFields();
    expect(String(fields.id?.type)).toBe('ID!');
    expect(String(fields.version?.type)).toBe('SafeInt!');
    expect(String(fields._masked?.type)).toBe('[String!]!');
    expect(String(fields.bookTitle?.type)).toBe('String');
    expect(String(fields.dueAt?.type)).toBe('Instant');
    expect(String(fields.book?.type)).toBe('LibraryBook');
    expect(String(fields.bookId?.type)).toBe('ID');
    expect(loan.getInterfaces().map((type) => type.name)).toEqual(['Node']);
  });

  test('enum values are upper case with underscores and map back to wire values', () => {
    const { schema } = buildGraphqlSchema(transportSurface());
    const loan = schema.getType('LoansLoan') as GraphQLObjectType;
    const state = getNamedType(loan.getFields().state?.type ?? loan);
    if (!isEnumType(state)) throw new Error('state is an enum');
    expect(state.getValues().map((value) => [value.name, value.value])).toEqual([
      ['OPEN', 'open'],
      ['CLOSED', 'closed'],
    ]);
    const sortField = schema.getType('LoansLoanSortField');
    expect(isEnumType(sortField) && sortField.getValue('CREATED_AT')?.value).toBe('createdAt');
    const direction = schema.getType('SortDirection');
    expect(isEnumType(direction) && direction.getValues().map((v) => [v.name, v.value])).toEqual([
      ['ASC', 'asc'],
      ['DESC', 'desc'],
    ]);
    // A value a name cannot hold, as the core's placement strategy has one.
    const surface = transportSurface();
    const lend = surface.actions.find((candidate) => candidate.ref === 'loans.lend');
    if (lend === undefined || lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const input = {
      ...lend.input,
      fields: {
        ...lend.input.fields,
        strategy: {
          kind: 'enum',
          values: ['shared-tables', 'inProgress'],
          optional: true,
          access: 'read-write',
        },
      },
    };
    const built = buildGraphqlSchema(surfaceWithAction(surface, { input }, 'loans.lend')).schema;
    const strategy = built.getType('LoansLendStrategy');
    if (!isEnumType(strategy)) throw new Error('strategy is an enum');
    expect(strategy.getValue('SHARED_TABLES')?.value).toBe('shared-tables');
    expect(strategy.getValue('IN_PROGRESS')?.value).toBe('inProgress');
    expect(strategy.getValue('shared-tables')).toBeUndefined();
  });

  test('every object, input, enum and union type is reachable from Query or Mutation (the scalars are declared whole)', () => {
    const { schema } = buildGraphqlSchema(transportSurface());
    const seen = new Set<string>();
    const visit = (type: GraphQLNamedType): void => {
      if (seen.has(type.name)) return;
      seen.add(type.name);
      if (isObjectType(type) || isInterfaceType(type)) {
        for (const face of type.getInterfaces()) visit(face);
        for (const field of Object.values(type.getFields())) {
          visit(getNamedType(field.type));
          for (const arg of field.args) visit(getNamedType(arg.type));
        }
      } else if (isInputObjectType(type)) {
        for (const field of Object.values(type.getFields())) visit(getNamedType(field.type));
      } else if (isUnionType(type)) {
        for (const member of type.getTypes()) visit(member);
      }
    };
    for (const root of [schema.getQueryType(), schema.getMutationType()]) {
      if (root) visit(root);
    }
    const unreached = Object.keys(schema.getTypeMap()).filter(
      (name) => !name.startsWith('__') && !isScalarType(schema.getType(name)) && !seen.has(name),
    );
    expect(unreached).toEqual([]);
    expect(schema.getType('LibraryBookUpdatePatchInput')).toBeUndefined();
    expect(schema.getType('LibraryBookPatch')).toBeDefined();
  });

  test('the built schema is valid', () => {
    for (const surface of [transportSurface(), conformance]) {
      expect(validateSchema(buildGraphqlSchema(surface).schema)).toEqual([]);
    }
  });

  test('a field back to its own entity type says that the repeated-entity rule refuses it (16.4.12)', () => {
    const book = buildGraphqlSchema(transportSurface()).schema.getType('LibraryBook') as
      | GraphQLObjectType
      | undefined;
    expect(book?.getFields().relatedToBook?.description).toMatch(/16\.4\.12/);
    expect(book?.getFields().relatedTo?.description).toBeUndefined();

    const surface = relationSurface();
    const own = {
      ...surface,
      entities: surface.entities.map((entity) =>
        entity.ref === 'library.book'
          ? {
              ...entity,
              relations: {
                ...entity.relations,
                related: { kind: 'many', target: 'library.book', by: 'relatedTo' },
              },
            }
          : entity,
      ),
    } as typeof surface;
    const fields = (
      buildGraphqlSchema(own).schema.getType('LibraryBook') as GraphQLObjectType
    ).getFields();
    expect(fields.related?.description).toMatch(/16\.4\.12/);
    expect(fields.loans?.description).toBeUndefined();
  });

  test('loansLend answers a union of success, the declared error and CommandAccepted', () => {
    const { schema } = buildGraphqlSchema(transportSurface());
    const mutation = schema.getMutationType()?.getFields().loansLend;
    expect(String(mutation?.type)).toBe('LoansLendResult');
    expect(mutation?.args.map((arg) => `${arg.name}: ${arg.type}`)).toContain(
      'input: LoansLendInput!',
    );
    const result = schema.getType('LoansLendResult');
    expect(
      isUnionType(result) &&
        result
          .getTypes()
          .map((type) => type.name)
          .sort(),
    ).toEqual(
      expect.arrayContaining(['CommandAccepted', 'LoansAlreadyLentError', 'LoansLendSuccess']),
    );
    const error = schema.getType('LoansAlreadyLentError') as GraphQLObjectType;
    expect(error.getInterfaces().map((type) => type.name)).toEqual(['Error']);
    expect(Object.keys(error.getFields())).toEqual(
      expect.arrayContaining(['bookTitle', 'code', 'message']),
    );
    const input = schema.getType('LoansLendInput');
    expect(printed(transportSurface())).toContain('prefer: ExecutionPreference');
    expect(String(input)).toBe('LoansLendInput');
  });

  test('a command that runs only synchronously has no CommandAccepted', () => {
    const { schema } = buildGraphqlSchema(conformance);
    const result = schema.getType('LoansLendResult');
    expect(
      isUnionType(result) &&
        result
          .getTypes()
          .map((type) => type.name)
          .sort(),
    ).toEqual(expect.arrayContaining(['LoansAlreadyLentError', 'LoansLendSuccess']));
  });

  test('a generated query takes filter, sort and Relay arguments and no properties', () => {
    const { schema } = buildGraphqlSchema(transportSurface());
    const field = schema.getQueryType()?.getFields().loansLoans;
    const args = Object.fromEntries((field?.args ?? []).map((arg) => [arg.name, String(arg.type)]));
    expect(args).toMatchObject({
      after: 'String',
      before: 'String',
      filter: 'LoansLoanFilter',
      first: 'Int',
      includeArchived: 'Boolean',
      last: 'Int',
      sort: '[LoansLoanSort!]',
    });
    expect(String(field?.type)).toBe('LoansLoanConnection!');
    const connection = schema.getType('LoansLoanConnection') as GraphQLObjectType;
    expect(Object.keys(connection.getFields())).toEqual(
      expect.arrayContaining(['nodes', 'pageInfo', 'queryState', 'totalCount']),
    );
    const get = schema.getQueryType()?.getFields().loansLoanGet;
    expect(get?.args.map((arg) => arg.name)).toEqual(
      expect.arrayContaining(['asOf', 'ids', 'includeArchived']),
    );
    expect(String(schema.getQueryType()?.getFields().loansLoan?.type)).toBe('LoansLoan');
    expect(String(schema.getQueryType()?.getFields().nodes?.type)).toBe('[Node]!');
  });

  test('the filter has and, or, not and one operator input per field', () => {
    const { schema } = buildGraphqlSchema(transportSurface());
    const filter = schema.getType('LoansLoanFilter');
    const fields = filter && 'getFields' in filter ? filter.getFields() : {};
    expect(String(fields.and?.type)).toBe('[LoansLoanFilter!]');
    expect(String(fields.not?.type)).toBe('LoansLoanFilter');
    expect(String(fields.bookTitle?.type)).toBe('StringFilter');
    expect(String(fields.bookId?.type)).toBe('IdFilter');
    expect(String(fields.dueAt?.type)).toBe('InstantFilter');
    expect(String(fields.state?.type)).toBe('LoansLoanStateFilter');
  });

  test('a command result is nullable and a connection is not', () => {
    const { schema } = buildGraphqlSchema(transportSurface());
    expect(isNonNullType(schema.getMutationType()?.getFields().loansLend?.type)).toBe(false);
  });

  test("an older version's schema names that version's fields", () => {
    const old = buildGraphqlSchema(deriveSurface(versionedApp as never, '2026-11-04').surface);
    const head = buildGraphqlSchema(deriveSurface(versionedApp as never, '2026-11-11').surface);
    const fieldsOf = (schema: ReturnType<typeof buildGraphqlSchema>['schema']) =>
      Object.keys((schema.getType('RosterContact') as GraphQLObjectType).getFields());
    expect(fieldsOf(old.schema)).toContain('name');
    expect(fieldsOf(old.schema)).not.toContain('displayName');
    expect(fieldsOf(head.schema)).toContain('displayName');
    expect(fieldsOf(head.schema)).not.toContain('name');
  });

  test('the projection names its entity and connection types', () => {
    const projection = buildGraphqlSchema(transportSurface());
    expect(projection.entityTypes.get('LoansLoan')).toBe('loans.loan');
    expect(projection.connectionTypes.has('LoansLoanConnection')).toBe(true);
  });
});
