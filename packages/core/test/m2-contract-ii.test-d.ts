import { describe, expectTypeOf, test } from 'vitest';
import type { FlagResolution } from '../src/contexts/flag-resolution.ts';
import type { LiveQueries } from '../src/contexts/live-queries.ts';
import type { CoreBase } from '../src/core-module/core-base-type.ts';
import { defineEffect } from '../src/dsl/define-effect.ts';
import type { FlagPurpose } from '../src/dsl/define-flag.ts';
import { extensionPoint } from '../src/dsl/extension-point.ts';
import type { EffectAttemptRecord } from '../src/effects/effect-attempt-record.ts';
import type { EffectInputOf, PendingEffect } from '../src/effects/pending-effect.ts';
import type { WireError } from '../src/errors/wire-error.ts';
import type { FlagRead } from '../src/events/flag-read.ts';
import type { StateToken } from '../src/events/state-token.ts';
import { field } from '../src/fields/field.ts';
import { shape } from '../src/fields/shape.ts';
import type { FlagContext } from '../src/flags/flag-context.ts';
import type { FlagProvider } from '../src/flags/flag-provider.ts';
import type { FlagSnapshot } from '../src/flags/flag-snapshot.ts';
import type { FlagSpec } from '../src/flags/flag-spec.ts';
import type { Id } from '../src/ids/id.ts';
import type { InvocationSession } from '../src/invoker/invocation-session.ts';
import type { LiveFrame } from '../src/invoker/live-frame.ts';
import type { CarrierConnection } from '../src/live/carrier-connection.ts';
import type { CarrierOptions } from '../src/live/carrier-options.ts';
import type { LiveCarrier } from '../src/live/live-carrier.ts';
import type { LiveHub } from '../src/live/live-hub.ts';
import type { WatchInput } from '../src/live/watch-input.ts';
import type { EntityChange } from '../src/model/entity-change.ts';
import type { IdOf } from '../src/model/id-of.ts';
import type { ModuleEntry } from '../src/registry/module-entry.ts';
import type { Artifact } from '../src/transport/artifact.ts';
import type { AuthBase } from './fixtures/modules/auth/src/base.ts';
import { hooksBase } from './fixtures/modules/hooks/src/base.ts';

interface Row {
  readonly id: Id<'shop.widget'>;
  readonly name: string;
}

declare const live: LiveQueries<AuthBase, readonly []>;
declare const hub: LiveHub;
declare const session: InvocationSession;
declare const provider: FlagProvider;
declare const spec: FlagSpec<boolean>;
declare const context: FlagContext;
declare const snapshot: FlagSnapshot;

const upload = defineEffect(hooksBase, {
  input: shape({ nodeId: field.string() }),
  performer: 'external',
});

describe('F-22 live', () => {
  test('EntityChange has the shape of 15.4.2', () => {
    type Written = Extract<
      EntityChange<Row>,
      { readonly type: 'created' | 'changed' | 'restored' }
    >;
    type Archived = Extract<EntityChange<Row>, { readonly type: 'archived' }>;
    type Removed = Extract<EntityChange<Row>, { readonly type: 'removed' }>;
    expectTypeOf<Written['type']>().toEqualTypeOf<'created' | 'changed' | 'restored'>();
    expectTypeOf<Written['version']>().toEqualTypeOf<number>();
    expectTypeOf<Pick<Written, 'cause'>>().toEqualTypeOf<{ readonly cause?: string }>();
    expectTypeOf<Written['row']>().toEqualTypeOf<Row>();
    expectTypeOf<Archived['version']>().toEqualTypeOf<number>();
    expectTypeOf<Pick<Archived, 'row'>>().toEqualTypeOf<{ readonly row?: Row }>();
    expectTypeOf<Removed['reason']>().toEqualTypeOf<'left-view' | 'purged' | 'erased'>();
    expectTypeOf<'row' extends keyof Removed ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<Written['id']>().toEqualTypeOf<IdOf<Row>>();
    expectTypeOf<Removed['id']>().toEqualTypeOf<Id<'shop.widget'>>();
    expectTypeOf<EntityChange<Row>['type']>().toEqualTypeOf<
      'created' | 'changed' | 'restored' | 'archived' | 'removed'
    >();
  });

  test('LiveQueries.entity takes ids, fields, includeArchived, from and after', () => {
    live.entity('auth', 'credential', {
      ids: ['a'],
      fields: ['id'],
      includeArchived: true,
      from: 'beginning',
      after: undefined,
    });
    // @ts-expect-error `from` is `now` or `beginning`
    live.entity('auth', 'credential', { from: 'later' });
  });

  test('LiveHub.entity yields frames of EntityChange', () => {
    expectTypeOf(hub.entity<Row>(session, 'shop.widget', {})).toEqualTypeOf<
      AsyncIterable<LiveFrame<EntityChange<Row>>>
    >();
    expectTypeOf(hub.stream<number>(session, 's', null, { from: 'now' })).toEqualTypeOf<
      AsyncIterable<LiveFrame<number>>
    >();
    expectTypeOf(hub.topic<number>(session, 't', null)).toEqualTypeOf<
      AsyncIterable<LiveFrame<number>>
    >();
  });

  test('LiveCarrier.serve takes a CarrierConnection and CarrierOptions', () => {
    expectTypeOf<Parameters<LiveCarrier['serve']>>().toEqualTypeOf<
      [AsyncIterable<LiveFrame<unknown>>, CarrierConnection, CarrierOptions]
    >();
    expectTypeOf<ReturnType<LiveCarrier['serve']>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<'sse'>().toExtend<LiveCarrier['name']>();
    expectTypeOf<'custom'>().toExtend<LiveCarrier['name']>();
  });

  test('CarrierConnection narrows by kind', () => {
    type Sse = Extract<CarrierConnection, { readonly kind: 'sse' }>;
    type Socket = Extract<CarrierConnection, { readonly kind: 'websocket' }>;
    expectTypeOf<Sse['lastEventId']>().toEqualTypeOf<string | null>();
    expectTypeOf<Sse['fail']>().parameter(0).toEqualTypeOf<WireError>();
    expectTypeOf<Parameters<Socket['close']>[0]>().toEqualTypeOf<1000 | 1001 | 1008 | 1011>();
    expectTypeOf<Socket['ping']>().returns.toEqualTypeOf<Promise<boolean>>();
  });

  test("WatchInput keeps after beside 15.4.2's members", () => {
    expectTypeOf<Pick<WatchInput<{ readonly a: 1 }>, 'filter' | 'after' | 'from'>>().toEqualTypeOf<{
      readonly filter?: { readonly a: 1 };
      readonly after?: string;
      readonly from?: 'now' | 'beginning';
    }>();
  });

  test('CoreBase has liveHub and liveCarriers and no entityActionGenerators', () => {
    type Points = CoreBase['extensionPoints'];
    expectTypeOf<Points['liveHub']['mode']>().toEqualTypeOf<'single'>();
    expectTypeOf<NonNullable<Points['liveHub']['~value']>>().toEqualTypeOf<LiveHub>();
    expectTypeOf<Points['liveCarriers']['mode']>().toEqualTypeOf<'set'>();
    expectTypeOf<NonNullable<Points['liveCarriers']['~value']>>().toEqualTypeOf<LiveCarrier>();
    expectTypeOf<
      'entityActionGenerators' extends keyof Points ? true : false
    >().toEqualTypeOf<false>();
  });

  test('a single point takes the options of a set point', () => {
    expectTypeOf(extensionPoint.single<number>({ min: 0 })).toEqualTypeOf<
      ReturnType<typeof extensionPoint.single<number>>
    >();
    // @ts-expect-error `min` is a number
    extensionPoint.single<number>({ min: 'none' });
  });
});

describe('F-23 flags', () => {
  test('FlagResolution defaults to boolean or string', () => {
    expectTypeOf<FlagResolution>().toEqualTypeOf<FlagResolution<boolean | string>>();
    expectTypeOf<FlagResolution['reason']>().toEqualTypeOf<
      'STATIC' | 'DEFAULT' | 'TARGETING_MATCH' | 'SPLIT' | 'DISABLED' | 'CACHED' | 'STALE' | 'ERROR'
    >();
    expectTypeOf<Pick<FlagResolution, 'errorCode'>>().toEqualTypeOf<{
      readonly errorCode?:
        | 'FLAG_NOT_FOUND'
        | 'TYPE_MISMATCH'
        | 'TARGETING_KEY_MISSING'
        | 'PARSE_ERROR'
        | 'GENERAL';
    }>();
    expectTypeOf<FlagResolution<number>['value']>().toEqualTypeOf<number>();
  });

  test('FlagSpec is the registry flag entry with key and typed default', () => {
    expectTypeOf<FlagSpec<boolean>['default']>().toEqualTypeOf<boolean>();
    expectTypeOf<FlagSpec['default']>().toEqualTypeOf<unknown>();
    expectTypeOf<FlagSpec['key']>().toEqualTypeOf<string>();
    expectTypeOf<Pick<FlagSpec, 'purpose'>>().toEqualTypeOf<{ readonly purpose?: FlagPurpose }>();
    expectTypeOf<FlagSpec['kind']>().toEqualTypeOf<
      'boolean' | 'string' | 'number' | 'json' | 'variant'
    >();
    expectTypeOf<ModuleEntry['flags'][string]['purpose']>().toEqualTypeOf<
      FlagPurpose | undefined
    >();
  });

  test('FlagProvider.resolve may pass, answer or promise', () => {
    expectTypeOf(provider.resolve(spec, context)).toEqualTypeOf<
      FlagResolution<boolean> | undefined | Promise<FlagResolution<boolean> | undefined>
    >();
    expectTypeOf<FlagProvider['sync']>().toEqualTypeOf<boolean>();
    expectTypeOf<NonNullable<FlagProvider['changes']>>().toEqualTypeOf<
      AsyncIterable<{ readonly keys: readonly string[] }>
    >();
  });

  test('FlagSnapshot.read answers FlagResolution<T>', () => {
    expectTypeOf(snapshot.read<number>('m.flag')).toEqualTypeOf<FlagResolution<number>>();
    expectTypeOf<FlagSnapshot['evaluations']>().toEqualTypeOf<readonly FlagRead[]>();
  });
});

describe('F-24 effects', () => {
  test('EffectInputOf reads the stored input of an EffectPart', () => {
    type Stored = NonNullable<(typeof upload)['~types']>['input'];
    expectTypeOf<EffectInputOf<typeof upload>>().toEqualTypeOf<Stored>();
    expectTypeOf<EffectInputOf<typeof upload>>().toEqualTypeOf<{ readonly nodeId: string }>();
    expectTypeOf<EffectInputOf<string>>().toBeNever();
    expectTypeOf<PendingEffect<typeof upload>['input']>().toEqualTypeOf<
      EffectInputOf<typeof upload>
    >();
    expectTypeOf<PendingEffect<typeof upload>['state']>().toEqualTypeOf<StateToken>();
    expectTypeOf<Pick<PendingEffect<typeof upload>, 'deadline'>>().toEqualTypeOf<{
      readonly deadline?: Temporal.Instant;
    }>();
  });

  test('EffectAttemptRecord.error is an optional projection of a WireError: code and status only', () => {
    expectTypeOf<Pick<EffectAttemptRecord, 'error'>>().toEqualTypeOf<{
      readonly error?: Pick<WireError, 'kind' | 'code' | 'retryable' | 'retryAfter' | 'requestId'>;
    }>();
    expectTypeOf<EffectAttemptRecord['attempt']>().toEqualTypeOf<number>();
  });
});

describe('the type-fragment artefact', () => {
  test('a type-fragment artefact takes module and names, or neither', () => {
    const plain: Artifact = { kind: 'type-fragment', content: 'export type A = 1;' };
    const imported: Artifact = {
      kind: 'type-fragment',
      content: 'type B = A;',
      module: '@keelwerk/module-a',
      names: ['A'],
    };
    expectTypeOf(plain).toExtend<Artifact>();
    expectTypeOf(imported).toExtend<Artifact>();
  });
});
