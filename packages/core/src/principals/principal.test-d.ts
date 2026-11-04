import { expectTypeOf, test } from 'vitest';
import type { Id } from '../ids/id.ts';
import type { SubjectId } from '../ids/subject-id.ts';
import type { Principal } from './principal.ts';
import type { PrincipalKind } from './principal-kind.ts';
import type { PrincipalOf } from './principal-of.ts';
import type { PrincipalRef } from './principal-ref.ts';
import type { UserPrincipal } from './user-principal.ts';

test('Principal narrows on kind', () => {
  expectTypeOf<Principal['kind']>().toEqualTypeOf<PrincipalKind>();
  expectTypeOf<Extract<Principal, { kind: 'user' }>>().toEqualTypeOf<UserPrincipal>();
  expectTypeOf<PrincipalOf<'user'>>().toEqualTypeOf<UserPrincipal>();
  expectTypeOf<PrincipalOf<'user' | 'service'>['kind']>().toEqualTypeOf<'user' | 'service'>();
});

test('a user principal has a subject, a service one does not', () => {
  expectTypeOf<UserPrincipal['subject']>().toEqualTypeOf<SubjectId>();
  expectTypeOf<PrincipalOf<'service'>>().not.toHaveProperty('subject');
  expectTypeOf<PrincipalOf<'anonymous'>>().not.toHaveProperty('subject');
});

test('subjectAs and idAs return branded ids or null', () => {
  expectTypeOf<ReturnType<UserPrincipal['subjectAs']>>().toEqualTypeOf<Id<string> | null>();
  const user = null as unknown as UserPrincipal;
  expectTypeOf(user.subjectAs('accounts.profile')).toEqualTypeOf<Id<'accounts.profile'> | null>();
});

test('the principal ref carries the resolving module fields', () => {
  interface AuthRef extends PrincipalRef {
    readonly sessionId: Id<'auth.session'>;
  }
  const principal = null as unknown as Principal<AuthRef>;
  expectTypeOf(principal.ref).toEqualTypeOf<AuthRef | null>();
  expectTypeOf<Principal['ref']>().toEqualTypeOf<PrincipalRef | null>();
});

test('a plain string is not a subject', () => {
  expectTypeOf<string>().not.toExtend<UserPrincipal['subject']>();
});
