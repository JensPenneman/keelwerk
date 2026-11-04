import { describe, expectTypeOf, test } from 'vitest';
import type { AccountsBase } from '../../test/fixtures/modules/accounts/src/base.ts';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { type AuthBase, authBase } from '../../test/fixtures/modules/auth/src/base.ts';
import type { whenAccounts } from '../../test/fixtures/modules/auth/src/conditional/when-accounts/condition.ts';
import { whenLive } from '../../test/fixtures/modules/auth/src/conditional/when-live/condition.ts';
import type { toAccounts } from '../../test/fixtures/modules/auth/src/contributions/to-accounts/contribution.ts';
import type { contracts } from '../dsl/contracts.ts';
import { defineModuleBase } from '../dsl/define-module-base.ts';
import { defineQuery } from '../dsl/define-query.ts';
import type { defineSubscription } from '../dsl/define-subscription.ts';
import { within } from '../dsl/within.ts';
import type { Id } from '../ids/id.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import type { SubjectId } from '../ids/subject-id.ts';
import type { PartSource, WhenOf } from '../model/part-source.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { LoadRequest } from '../protocol/load-request.ts';
import type { Request } from '../protocol/request.ts';
import type { UpdateDraft } from '../protocol/update-draft.ts';
import type { Empty } from '../types/empty.ts';
import type { DecideContext } from './decide-context.ts';
import type { LiveQueries } from './live-queries.ts';
import type { Maybe } from './maybe-accessor.ts';

type AuthCtx = DecideContext<AuthBase>;
type InAccounts = WhenOf<ReturnType<typeof within<AuthBase, typeof whenAccounts>>>;
type InToAccounts = WhenOf<ReturnType<typeof within<AuthBase, typeof toAccounts>>>;
type CredentialRow = NonNullable<
  ReturnType<AuthCtx['load']['auth']['credential']['byId']> extends Request<infer R> ? R : never
>;

const directorySyncBase = defineModuleBase({
  id: 'directory-sync',
  version: '0.1.0',
  requires: [accounts],
});

describe('module-local contexts over the base alone (checklist 2)', () => {
  test('own rows carry hidden fields and secret references', () => {
    expectTypeOf<CredentialRow>().toHaveProperty('verifier').toEqualTypeOf<string>();
    expectTypeOf<CredentialRow>()
      .toHaveProperty('recoveryKey')
      .toEqualTypeOf<SecretRef | undefined>();
    expectTypeOf<CredentialRow>()
      .toHaveProperty('profileId')
      .toEqualTypeOf<Id<'accounts.profile'> | undefined>();
  });

  test('loads are frozen request payloads (S-50)', () => {
    expectTypeOf<ReturnType<AuthCtx['load']['auth']['credential']['byId']>>().toExtend<
      LoadRequest<CredentialRow | undefined>
    >();
    expectTypeOf<
      ReturnType<AuthCtx['write']['auth']['session']['update']>
    >().toEqualTypeOf<UpdateDraft>();
  });

  test('an optional module is reached through the Maybe accessor; inside its conditional part it is present', () => {
    expectTypeOf<AuthCtx['load']['accounts']>().toHaveProperty('ifPresent');
    expectTypeOf<AuthCtx['load']['accounts']>().not.toHaveProperty('profile');
    expectTypeOf<DecideContext<AuthBase, InAccounts>['load']['accounts']>().toHaveProperty(
      'profile',
    );
    type Ifp = AuthCtx['load']['accounts'] extends Maybe<infer L> ? L : never;
    expectTypeOf<Ifp>().toHaveProperty('profile');
  });

  test('dependency rows exclude hidden fields and include what this module contributed (decision 106)', () => {
    type Profile = NonNullable<
      ReturnType<
        DecideContext<AuthBase, InToAccounts>['load']['accounts']['profile']['byId']
      > extends Request<infer R>
        ? R
        : never
    >;
    expectTypeOf<Profile>()
      .toHaveProperty('lastLoginAt')
      .toEqualTypeOf<Temporal.Instant | undefined>();
    expectTypeOf<Profile>()
      .toHaveProperty('lastCredentialId')
      .toEqualTypeOf<Id<'auth.credential'> | undefined>();
    expectTypeOf<Profile>().toHaveProperty('email').toEqualTypeOf<string>();
  });

  test('writes: own entities fully, another module only for the fields this module contributed', () => {
    type Writes = DecideContext<AuthBase, InToAccounts>['write'];
    expectTypeOf<Parameters<Writes['accounts']['profile']['update']>[1]>().toEqualTypeOf<{
      readonly lastLoginAt?: Temporal.Instant | null;
      readonly lastCredentialId?: Id<'auth.credential'> | null;
    }>();
    expectTypeOf<Writes['accounts']['profile']>().not.toHaveProperty('create');
    expectTypeOf<AuthCtx['write']>().not.toHaveProperty('accounts');
    expectTypeOf<Writes['auth']['credential']>().toHaveProperty('revoked');
    expectTypeOf<Parameters<Writes['auth']['session']['create']>[0]>().toHaveProperty(
      'tokenVerifier',
    );
  });

  test('the auth principal reference is typed by auth, and a user has a SubjectId (decisions 92 and 93)', () => {
    type UserCtx = DecideContext<AuthBase, readonly [], undefined, 'user'>;
    type Ref = NonNullable<UserCtx['principal']['ref']>;
    expectTypeOf<Ref['sessionId']>().toEqualTypeOf<Id<'auth.session'>>();
    expectTypeOf<Ref['credentialId']>().toEqualTypeOf<Id<'auth.credential'>>();
    expectTypeOf<Ref>().toExtend<PrincipalRef>();
    expectTypeOf<UserCtx['principal']['subject']>().toEqualTypeOf<SubjectId>();
    expectTypeOf<
      DecideContext<AccountsBase>['principal']['ref']
    >().toEqualTypeOf<PrincipalRef | null>();
  });

  test('a required module is present; hyphenated ids appear in lower camel case (gap G15)', () => {
    type Ctx = DecideContext<typeof directorySyncBase>;
    expectTypeOf<Ctx['load']>().toHaveProperty('directorySync');
    expectTypeOf<Ctx['load']['accounts']['profile']>().toHaveProperty('byId');
    expectTypeOf<ReturnType<Ctx['services']['accounts']['findByEmail']>>().toEqualTypeOf<
      ReturnType<DecideContext<AccountsBase>['load']['accounts']['profile']['one']>
    >();
    expectTypeOf<AuthCtx['services']['accounts']>().toHaveProperty('ifPresent');
  });

  test('ctx.live follows the contract: optional is possibly undefined, within the condition it is present, absent otherwise', () => {
    defineQuery(within(authBase, whenLive), { read: () => undefined });
    type Live<S> = S extends { readonly live: infer L } ? L : never;
    type SourceCtxOf<S extends PartSource> = Parameters<
      Parameters<typeof defineSubscription<S, Empty>>[1]['source']
    >[1];
    expectTypeOf<Live<SourceCtxOf<AuthBase>>>().toEqualTypeOf<
      LiveQueries<AuthBase, readonly []> | undefined
    >();
    expectTypeOf<
      Live<SourceCtxOf<ReturnType<typeof within<AuthBase, typeof whenLive>>>>
    >().toExtend<LiveQueries<AuthBase, InAccounts | readonly [typeof contracts.live]>>();
    expectTypeOf<Live<SourceCtxOf<AccountsBase>>>().toBeNever();
  });
});
