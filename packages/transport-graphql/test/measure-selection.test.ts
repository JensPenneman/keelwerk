import { defaultSelectionLimits } from '@keelwerk/core';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import { measureSelection } from '../src/limits/measure-selection.ts';
import { buildGraphqlSchema } from '../src/schema/build-graphql-schema.ts';
import { transportSurface } from './support/graphql-kit.ts';
import { relationSurface } from './support/relation-surface.ts';

const surface = transportSurface();
const projection = buildGraphqlSchema(surface);
const relationProjection = buildGraphqlSchema(relationSurface());

function measure(...queries: string[]) {
  return measureSelection(
    queries.map((query) => parse(query)),
    relationProjection,
    defaultSelectionLimits,
  );
}

describe('measureSelection', () => {
  test('a document with aliases, two operations and a connection page is counted', () => {
    const document = `
      query First { first: loansLoans(first: 5) { nodes { id title: bookTitle book { title } } pageInfo { hasNextPage } } }
      query Second { __typename }`;
    const counted = measure(document);
    expect(counted.operations).toBe(2);
    expect(counted.aliases).toBe(2);
    expect(counted.connectionPages).toBe(1);
    expect(counted.tokens).toBe(parse(document).tokenCount);
    expect(counted.paths).toEqual([
      { entities: ['loans.loan'], field: 'id' },
      { entities: ['loans.loan'], field: 'bookTitle' },
      { entities: ['loans.loan', 'library.book'], field: 'title' },
      { entities: [], field: 'hasNextPage' },
      { entities: [], field: '__typename' },
    ]);
  });

  test('a batch is one request: operations, aliases and tokens add up over its documents', () => {
    const one = '{ a: __typename }';
    const counted = measure(one, one, one);
    expect(counted.operations).toBe(3);
    expect(counted.aliases).toBe(3);
    expect(counted.tokens).toBe(3 * (parse(one).tokenCount ?? 0));
  });

  test('a fragment spread twice counts its leaves twice', () => {
    const counted = measure(`
      query { a: loansLoans { nodes { ...L } } b: loansLoans { nodes { ...L } } }
      fragment L on LoansLoan { id bookTitle }`);
    expect(counted.paths.filter((path) => path.field === 'bookTitle')).toHaveLength(2);
    expect(counted.paths).toHaveLength(4);
    expect(counted.connectionPages).toBe(2);
  });

  test('a fragment on an entity type adds that entity below an abstract type', () => {
    const counted = measure('{ node(id: "loan_x") { ... on LoansLoan { id book { id } } } }');
    expect(counted.paths).toEqual([
      { entities: ['loans.loan'], field: 'id' },
      { entities: ['loans.loan', 'library.book'], field: 'id' },
    ]);
  });

  test('an exponential fragment document stops after the cost limit', () => {
    const levels = 40;
    const fragments = Array.from(
      { length: levels },
      (_, level) => `fragment F${level} on Query { ...F${level + 1} ...F${level + 1} }`,
    );
    const document = `query { ...F0 } ${fragments.join(' ')} fragment F${levels} on Query { __typename }`;
    const started = Date.now();
    const counted = measure(document);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(counted.paths.length).toBeLessThanOrEqual(defaultSelectionLimits.cost + 1);
    expect(counted.paths.length).toBeGreaterThan(defaultSelectionLimits.cost);
  });

  test('a fragment document with no leaf at its end stops after its step budget', () => {
    const levels = 40;
    const fragments = Array.from(
      { length: levels },
      (_, level) => `fragment F${level} on Query { ...F${level + 1} ...F${level + 1} }`,
    );
    const document = `query { ...F0 } ${fragments.join(' ')} fragment F${levels} on Query { ...Missing }`;
    const started = Date.now();
    const counted = measure(document);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(counted.paths.length).toBeGreaterThan(defaultSelectionLimits.cost);
  });

  test('a fragment cycle does not loop', () => {
    const counted = measure(`
      query { loansLoans { nodes { ...A } } }
      fragment A on LoansLoan { id ...B }
      fragment B on LoansLoan { bookTitle ...A }`);
    expect(counted.paths.map((path) => path.field)).toEqual(['id', 'bookTitle']);
  });

  test('fields under @skip count', () => {
    const counted = measure(
      'query($skip: Boolean!) { loansLoans { nodes { id bookTitle @skip(if: $skip) dueAt @include(if: false) } } }',
    );
    expect(counted.paths.map((path) => path.field)).toEqual(['id', 'bookTitle', 'dueAt']);
  });

  test('the selection of an unknown field is walked, its children are leaves of no entity', () => {
    const counted = measure('{ loansLoans { nodes { nope { deeper { deepest } } } } }');
    expect(counted.paths).toEqual([{ entities: [], field: 'deepest' }]);
    const many = measure(`{ nope { ${'a '.repeat(50)} } }`);
    expect(many.paths).toHaveLength(50);
  });

  test('a scalar given a selection and a field picked on a union are walked too', () => {
    const scalar = measure('{ loansLoans { nodes { bookTitle { x y } } } }');
    expect(scalar.paths.map((path) => path.field)).toEqual(['x', 'y']);
    const union = measure(
      'mutation { loansLend(input: { bookTitle: "T", dueAt: "2026-12-01T00:00:00Z" }) { bookTitle { a } } }',
    );
    expect(union.paths.map((path) => path.field)).toEqual(['a']);
  });

  test('a leaf below an introspection list is charged the sizes of the lists above it', () => {
    const { introspectionSizes } = relationProjection;
    const types = introspectionSizes.get('__Schema.types') ?? 0;
    const fields = introspectionSizes.get('__Type.fields') ?? 0;
    const args = introspectionSizes.get('__Field.args') ?? 0;
    expect(Math.min(types, fields, args)).toBeGreaterThan(1);
    const measured = (query: string) =>
      measureSelection([parse(query)], relationProjection, {
        ...defaultSelectionLimits,
        cost: 1e7,
      }).paths;
    expect(measured('{ __schema { types { name fields { name args { name } } } } }')).toHaveLength(
      types + types * fields + types * fields * args,
    );
    expect(measured('{ __type(name: "LoansLoan") { name fields { name } } }')).toHaveLength(
      1 + fields,
    );
    expect(measured('{ __schema { queryType { name fields { name } } } }')).toHaveLength(
      1 + fields,
    );
  });

  test('a connection below a connection costs its own pages times the page size above it', () => {
    const query = (outer: string, inner: string) =>
      `{ libraryBooks${outer} { nodes { loans${inner} { nodes { id } } } } }`;
    expect(measure(query('(first: 5)', '(first: 3)')).connectionPages).toBe(1 + 5);
    expect(measure(query('(first: 5)', '(last: 3)')).connectionPages).toBe(1 + 5);
    const variables = [{ outer: 7 }];
    expect(
      measureSelection(
        [
          parse(
            'query($outer: Int) { libraryBooks(first: $outer) { nodes { loans(first: 2) { nodes { id } } } } }',
          ),
        ],
        relationProjection,
        defaultSelectionLimits,
        variables,
      ).connectionPages,
    ).toBe(1 + 7);
    // Absent, the page is the type's largest.
    const largest = surface.entities.find((entity) => entity.ref === 'library.book')?.page.maxSize;
    expect(measure(query('', '(first: 3)')).connectionPages).toBe(1 + (largest ?? 0));
  });

  test('nodes and a get field are pages whose size is the number of ids', () => {
    const nodes = measure('{ nodes(ids: ["a", "b", "c"]) { ... on LoansLoan { book { id } } } }');
    expect(nodes.connectionPages).toBe(1);
    expect(nodes.idLists).toEqual([{ field: 'nodes', count: 3, max: expect.any(Number) }]);
    const get = measure('{ libraryBookGet(ids: ["a", "b"]) { list { id } } }');
    expect(get.connectionPages).toBe(1);
    expect(get.idLists).toMatchObject([{ field: 'libraryBookGet', count: 2 }]);
    const variable = measureSelection(
      [parse('query($ids: [ID!]!) { nodes(ids: $ids) { id } }')],
      projection,
      defaultSelectionLimits,
      [{ ids: ['a', 'b', 'c', 'd'] }],
    );
    expect(variable.idLists).toMatchObject([{ field: 'nodes', count: 4 }]);
  });

  test('a repeated entity type is visible in the path', () => {
    const counted = measure('{ loansLoans { nodes { book { relatedToBook { title } } } } }');
    expect(counted.paths).toEqual([
      { entities: ['loans.loan', 'library.book', 'library.book'], field: 'title' },
    ]);
  });
});
