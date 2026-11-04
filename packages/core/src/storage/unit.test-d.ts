import { expectTypeOf, test } from 'vitest';
import type { Condition } from '../conditions/condition.ts';
import type { ConditionOp } from '../conditions/condition-op.ts';
import type { EntityDescriptor } from './entity-descriptor.ts';
import type { JobOutcome } from './job-outcome.ts';
import type { JobStore } from './job-store.ts';
import type { MigrationStep } from './migration-step.ts';
import type { ReceiptOutcome } from './receipt-outcome.ts';
import type { RowPage } from './row-page.ts';
import type { RowQuery } from './row-query.ts';
import type { RowStore } from './row-store.ts';
import type { ScopeKeyStore } from './scope-key-store.ts';
import type { Unit } from './unit.ts';

test('Unit has exactly the members of S-03', () => {
  expectTypeOf<keyof Unit>().toEqualTypeOf<
    | 'namespace'
    | 'scope'
    | 'readOnly'
    | 'rows'
    | 'events'
    | 'receipts'
    | 'jobs'
    | 'usage'
    | 'buckets'
    | 'keys'
    | 'serials'
    | 'scopeKeys'
    | 'nested'
    | 'afterCommit'
  >();
  expectTypeOf<Unit['scopeKeys']>().toEqualTypeOf<ScopeKeyStore | undefined>();
  expectTypeOf<Unit['jobs']>().toEqualTypeOf<JobStore>();
});

test('JobStore lacks schedules until M2', () => {
  expectTypeOf<keyof JobStore>().toEqualTypeOf<
    | 'provisionGroup'
    | 'enqueue'
    | 'cancel'
    | 'promote'
    | 'take'
    | 'heartbeat'
    | 'complete'
    | 'stats'
  >();
});

test('a positioned query returns the position of its page', () => {
  expectTypeOf<RowQuery['positioned']>().toEqualTypeOf<true | undefined>();
  expectTypeOf<RowPage['position']>().toEqualTypeOf<bigint | undefined>();
});

test('the row store takes the shared condition AST', () => {
  expectTypeOf<RowQuery['where']>().toEqualTypeOf<Condition | undefined>();
  expectTypeOf<Parameters<RowStore['count']>[1]>().toEqualTypeOf<Condition | undefined>();
  expectTypeOf<Parameters<RowStore['find']>[0]>().toEqualTypeOf<EntityDescriptor>();
});

test('the discriminants of the stored formats are pinned', () => {
  type Op =
    | 'eq'
    | 'ne'
    | 'lt'
    | 'lte'
    | 'gt'
    | 'gte'
    | 'in'
    | 'nin'
    | 'contains'
    | 'startsWith'
    | 'isNull'
    | 'and'
    | 'or'
    | 'not'
    | 'some'
    | 'none'
    | 'every'
    | 'is'
    | 'never';
  expectTypeOf<Condition['op']>().toEqualTypeOf<Op>();
  expectTypeOf<ConditionOp>().toEqualTypeOf<Op>();
  expectTypeOf<JobOutcome['kind']>().toEqualTypeOf<'succeeded' | 'retry' | 'failed' | 'dead'>();
  expectTypeOf<MigrationStep['op']>().toEqualTypeOf<
    | 'createTable'
    | 'dropTable'
    | 'addColumn'
    | 'dropColumn'
    | 'alterColumn'
    | 'copyColumn'
    | 'createIndex'
    | 'dropIndex'
    | 'addForeignKey'
    | 'dropForeignKey'
    | 'enableMergeState'
    | 'rebuild'
    | 'sql'
  >();
  expectTypeOf<ReceiptOutcome['ok']>().toEqualTypeOf<boolean>();
  expectTypeOf<Extract<ReceiptOutcome, { ok: true; ref: unknown }>['ref']>().toEqualTypeOf<{
    readonly entity: string;
    readonly id: string;
    readonly version: number;
  }>();
  expectTypeOf<Extract<ReceiptOutcome, { ok: false }>['error']>().not.toBeAny();
});
