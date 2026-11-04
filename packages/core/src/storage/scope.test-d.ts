import { expectTypeOf, test } from 'vitest';
import type { Id } from '../ids/id.ts';
import type { SubjectId } from '../ids/subject-id.ts';
import type { Position } from './position.ts';
import type { Scope } from './scope.ts';
import type { StorageScope } from './storage-scope.ts';

test('Scope excludes the namespace level', () => {
  expectTypeOf<Scope['level']>().toEqualTypeOf<'tenant' | 'backend' | 'deployment'>();
  expectTypeOf<StorageScope['level']>().toEqualTypeOf<
    'tenant' | 'backend' | 'deployment' | 'namespace'
  >();
  expectTypeOf<Extract<StorageScope, { level: 'namespace' }>>().not.toExtend<Scope>();
  expectTypeOf<Scope>().toExtend<StorageScope>();
});

test('Position is a bigint', () => {
  expectTypeOf<Position>().toEqualTypeOf<bigint>();
});

test('SubjectId rejects a plain string', () => {
  expectTypeOf<string>().not.toExtend<SubjectId>();
  expectTypeOf<SubjectId>().toExtend<string>();
});

test('an Id is branded by its entity', () => {
  expectTypeOf<string>().not.toExtend<Id<'accounts.profile'>>();
  expectTypeOf<Id<'accounts.profile'>>().not.toExtend<Id<'auth.credential'>>();
  expectTypeOf<Id<'accounts.profile'>>().toExtend<string>();
});
