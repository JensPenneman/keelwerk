import { expectTypeOf, test } from 'vitest';
import type { EntityLoads } from '../contexts/entity-loads.ts';
import type { LiveQueries } from '../contexts/live-queries.ts';
import type { QuerySpec } from '../contexts/query-spec.ts';
import type { LiveEntitySource } from '../live/live-entity-source.ts';
import type { WatchInput } from '../live/watch-input.ts';
import type { QueryDescription } from '../protocol/query-description.ts';
import type { RowQuery } from './row-query.ts';

interface Row {
  readonly id: string;
  readonly title: string;
}

declare const loads: EntityLoads<Row, Row>;
declare const rowId: Parameters<EntityLoads<Row, Row>['byId']>[0];

test('includeErased is a member of RowQuery, which only the kernel builds', () => {
  expectTypeOf<RowQuery>().toHaveProperty('includeErased');
});

test('no input a module, a filter, a hop or a watch describes has an includeErased member', () => {
  expectTypeOf<QuerySpec<Row>>().not.toHaveProperty('includeErased');
  expectTypeOf<QueryDescription>().not.toHaveProperty('includeErased');
  expectTypeOf<WatchInput<unknown>>().not.toHaveProperty('includeErased');
  expectTypeOf<LiveEntitySource['options']>().not.toHaveProperty('includeErased');
  type LiveOptions = NonNullable<Parameters<LiveQueries<never, never>['entity']>[2]>;
  expectTypeOf<LiveOptions>().not.toHaveProperty('includeErased');
  expectTypeOf<Parameters<EntityLoads<Row, Row>['many']>[0]>().not.toHaveProperty('includeErased');
  expectTypeOf<Parameters<EntityLoads<Row, Row>['one']>[0]>().not.toHaveProperty('includeErased');
  expectTypeOf<NonNullable<Parameters<EntityLoads<Row, Row>['history']>[1]>>().not.toHaveProperty(
    'includeErased',
  );
});

test('a call of a module that names includeErased does not compile', () => {
  // @ts-expect-error a load takes no includeErased
  loads.many({ where: { title: 'x' }, includeErased: true });
  // @ts-expect-error a load takes no includeErased
  loads.one({ where: { title: 'x' }, includeErased: true });
  // @ts-expect-error a query takes no includeErased
  loads.query({ includeErased: true });
  // @ts-expect-error a history read takes no includeErased
  loads.history(rowId, { includeErased: true });
});
