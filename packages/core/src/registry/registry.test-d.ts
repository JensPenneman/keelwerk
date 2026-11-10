import { expectTypeOf, test } from 'vitest';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { IssuedSecret } from '../kernel/issued-secret.ts';
import type { LedgerRecord } from '../kernel/ledger-record.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { SecretResolver } from '../kernel/secret-resolver.ts';
import type { AnyRequest } from '../protocol/any-request.ts';
import type { AdapterEnvironment } from '../storage/adapter-environment.ts';
import type { ActionEntry } from './action-entry.ts';
import type { ActionHandler } from './action-handler.ts';
import type { EntityEntry } from './entity-entry.ts';
import type { Registry } from './registry.ts';

test('ActionEntry.handler excludes promise-returning functions', () => {
  expectTypeOf<ActionEntry['handler']>().toEqualTypeOf<ActionHandler>();
  expectTypeOf<(input: string) => { readonly events: readonly [] }>().toExtend<ActionHandler>();
  expectTypeOf<(input: string) => Generator<never, number, unknown>>().toExtend<ActionHandler>();
  expectTypeOf<(input: string) => number>().toExtend<ActionHandler>();
  expectTypeOf<(input: string) => Promise<number>>().not.toExtend<ActionHandler>();
  expectTypeOf<(input: string) => PromiseLike<void>>().not.toExtend<ActionHandler>();
  expectTypeOf<() => Promise<undefined>>().not.toExtend<ActionHandler>();
  expectTypeOf<
    (input: string) => AsyncGenerator<never, number, unknown>
  >().not.toExtend<ActionHandler>();
});

test('RequestAnswerer has one answerer per AnyRequest kind', () => {
  expectTypeOf<keyof RequestAnswerer>().toEqualTypeOf<AnyRequest['kind']>();
  type Id = Extract<AnyRequest, { kind: 'id' }>;
  expectTypeOf<RequestAnswerer['id']>().toEqualTypeOf<
    (request: Id, context: AnswerContext) => Promise<string>
  >();
  expectTypeOf<ReturnType<RequestAnswerer['random']>>().toEqualTypeOf<Promise<Uint8Array>>();
  expectTypeOf<ReturnType<RequestAnswerer['all']>>().toEqualTypeOf<Promise<readonly unknown[]>>();
  expectTypeOf<Awaited<ReturnType<RequestAnswerer['secret']>>>().toEqualTypeOf<
    IssuedSecret | string | boolean
  >();
  expectTypeOf<IssuedSecret>().toHaveProperty('plain');
  expectTypeOf<IssuedSecret['plain']>().toEqualTypeOf<string>();
  expectTypeOf<Awaited<ReturnType<RequestAnswerer['compute']>>>().toEqualTypeOf<string | boolean>();
  expectTypeOf<Parameters<RequestAnswerer['perform']>[0]['kind']>().toEqualTypeOf<'perform'>();
});

test('LedgerRecord is a union on type with anchor', () => {
  expectTypeOf<LedgerRecord['type']>().toEqualTypeOf<'anchor' | 'erasure' | 'keyTombstone'>();
  expectTypeOf<Extract<LedgerRecord, { type: 'anchor' }>['position']>().toEqualTypeOf<string>();
  expectTypeOf<Extract<LedgerRecord, { type: 'anchor' }>>().toHaveProperty('hash');
});

test('the adapter environment resolves secrets through the kernel resolver', () => {
  expectTypeOf<AdapterEnvironment['secrets']>().toEqualTypeOf<SecretResolver>();
});

test('entries carry what the surface needs, without the raw literals', () => {
  expectTypeOf<ActionEntry>().toHaveProperty('ref');
  expectTypeOf<ActionEntry>().toHaveProperty('execution');
  expectTypeOf<ActionEntry>().toHaveProperty('changedIn');
  expectTypeOf<ActionEntry['input']>().toEqualTypeOf<StandardSchemaV1>();
  expectTypeOf<EntityEntry>().toHaveProperty('prefix');
  expectTypeOf<EntityEntry>().toHaveProperty('descriptor');
  expectTypeOf<EntityEntry>().toHaveProperty('origin');
  expectTypeOf<Extract<keyof ActionEntry, 'literal' | 'definition' | 'part'>>().toBeNever();
  expectTypeOf<Extract<keyof EntityEntry, 'literal' | 'definition' | 'part'>>().toBeNever();
});

test('the registry looks entries up by reference', () => {
  expectTypeOf<Registry['actions']>().toEqualTypeOf<ReadonlyMap<string, ActionEntry>>();
  expectTypeOf<Registry['entities']>().toEqualTypeOf<ReadonlyMap<string, EntityEntry>>();
});
