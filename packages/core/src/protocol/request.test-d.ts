import { expectTypeOf, test } from 'vitest';
import type { Answer } from './answer.ts';
import type { AnyDraft } from './any-draft.ts';
import type { AnyEffect } from './any-effect.ts';
import type { AnyRequest } from './any-request.ts';
import type { Draft } from './draft.ts';
import type { EffectDraft } from './effect-draft.ts';
import type { Gen } from './gen.ts';
import type { Pending } from './pending.ts';
import type { Request } from './request.ts';
import type { RequestKind } from './request-kind.ts';

declare function answered<T>(request: Request<T>): Gen<T>;

test('yield* over a Request<T> types the answer as T', () => {
  function* handler(count: Request<number>, name: Request<string>): Gen<readonly [number, string]> {
    const a = yield* count;
    const b = yield* name;
    expectTypeOf(a).toEqualTypeOf<number>();
    expectTypeOf(b).toEqualTypeOf<string>();
    return [a, b];
  }
  expectTypeOf(handler).returns.toEqualTypeOf<Gen<readonly [number, string]>>();
  expectTypeOf(answered<boolean>).returns.toEqualTypeOf<Generator<Pending, boolean, unknown>>();
});

test('a request is not itself a yieldable value', () => {
  expectTypeOf<Request<number>>().not.toExtend<Pending>();
});

test('AnyRequest narrows on kind and covers every RequestKind', () => {
  expectTypeOf<AnyRequest['kind']>().toEqualTypeOf<RequestKind>();
  expectTypeOf<Extract<AnyRequest, { kind: 'load' }>['op']>().toEqualTypeOf<
    'byId' | 'one' | 'many' | 'count' | 'exists' | 'query'
  >();
  expectTypeOf<Extract<AnyRequest, { kind: 'secret' }>['op']>().toEqualTypeOf<
    'issue' | 'reveal' | 'verify'
  >();
  expectTypeOf<Extract<AnyRequest, { kind: 'compute' }>['op']>().toEqualTypeOf<
    'argon2idHash' | 'argon2idVerify' | 'argon2idNeedsRehash'
  >();
  expectTypeOf<Extract<AnyRequest, { kind: 'load' }>['view']>().toEqualTypeOf<
    'module' | 'caller'
  >();
});

test('AnyDraft narrows on kind and every draft is a Draft', () => {
  expectTypeOf<AnyDraft['kind']>().toEqualTypeOf<
    'create' | 'update' | 'archive' | 'restore' | 'event'
  >();
  expectTypeOf<AnyDraft>().toExtend<Draft>();
  expectTypeOf<Extract<AnyDraft, { kind: 'update' }>['expectedVersion']>().toEqualTypeOf<
    number | undefined
  >();
});

test('AnyEffect narrows on kind and every effect is an EffectDraft', () => {
  expectTypeOf<AnyEffect['kind']>().toEqualTypeOf<
    'invoke' | 'enqueue' | 'setTimer' | 'cancelTimer' | 'settle' | 'external'
  >();
  expectTypeOf<AnyEffect>().toExtend<EffectDraft>();
  expectTypeOf<Extract<AnyEffect, { kind: 'cancelTimer' }>['key']>().toBeString();
});

test('Answer narrows on kind', () => {
  expectTypeOf<Answer['kind']>().toEqualTypeOf<'id' | 'random' | 'secret'>();
});
