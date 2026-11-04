import { describe, expectTypeOf, test } from 'vitest';
import type { PartTypes } from './action-part.ts';
import type { DecideContext } from './decide-context.ts';
import type { Draft } from './decision.ts';
import { defineCommand } from './define-command.ts';
import { defineEntity } from './define-entity.ts';
import { defineModule } from './define-module.ts';
import { defineModuleBase } from './define-module-base.ts';
import { defineQuery } from './define-query.ts';
import { defineReaction } from './define-reaction.ts';
import { defineRule } from './define-rule.ts';
import type { EffectOutcome } from './effect-outcome.ts';
import { field } from './field.ts';
import { type AccountsBase, accountsBase } from './fixtures/accounts/base.ts';
import { profile } from './fixtures/accounts/entities/profile.ts';
import { accounts } from './fixtures/accounts/module.generated.ts';
import { type AuthBase, authBase } from './fixtures/auth/base.ts';
import { whenAccounts } from './fixtures/auth/conditional/when-accounts/condition.ts';
import { whenLive } from './fixtures/auth/conditional/when-live/condition.ts';
import { toAccounts } from './fixtures/auth/contributions/to-accounts/contribution.ts';
import { credential } from './fixtures/auth/entities/credential.ts';
import { revoke } from './fixtures/auth/entity-actions/credential/revoke.ts';
import type { testEndpoint } from './fixtures/hooks/actions/test-endpoint.ts';
import { hooksBase } from './fixtures/hooks/base.ts';
import { post } from './fixtures/hooks/effects/post.ts';
import type { recordOutcome } from './fixtures/hooks/entity-actions/delivery/record-outcome.ts';
import { post as postExecutor } from './fixtures/hooks/executors/post.ts';
import { type Hooks, hooks } from './fixtures/hooks/module.generated.ts';
import type { Id, SecretRef, SubjectId } from './id.ts';
import type { Maybe } from './loads-of.ts';
import type { WhenOf } from './part-source.ts';
import type { Request } from './request.ts';
import { shape } from './shape.ts';
import type { LiveQueries } from './source-context.ts';
import { within } from './within.ts';

type AuthCtx = DecideContext<AuthBase>;
type InAccounts = WhenOf<ReturnType<typeof within<AuthBase, typeof whenAccounts>>>;
type InToAccounts = WhenOf<ReturnType<typeof within<AuthBase, typeof toAccounts>>>;
type CredentialRow = NonNullable<
  Awaited<ReturnType<AuthCtx['load']['auth']['credential']['byId']>> extends Request<infer R>
    ? R
    : never
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

  test('an optional module is reached through the Maybe accessor; inside its conditional part it is present', () => {
    expectTypeOf<AuthCtx['load']['accounts']>().toHaveProperty('ifPresent');
    expectTypeOf<AuthCtx['load']['accounts']>().not.toHaveProperty('profile');
    expectTypeOf<DecideContext<AuthBase, InAccounts>['load']['accounts']>().toHaveProperty(
      'profile',
    );
    type Ifp = AuthCtx['load']['accounts'] extends Maybe<infer L> ? L : never;
    expectTypeOf<Ifp>().toHaveProperty('profile');
  });

  test('dependency rows exclude hidden fields and include what this module contributed', () => {
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
    defineQuery(within(authBase, whenLive), {
      read: () => undefined,
    });
    type Live<S> = S extends { readonly live: infer L } ? L : never;
    type AuthSource = Parameters<
      Parameters<
        typeof import('./define-subscription.ts').defineSubscription<AuthBase, {}>
      >[1]['source']
    >[1];
    expectTypeOf<Live<AuthSource>>().toEqualTypeOf<
      LiveQueries<AuthBase, readonly []> | undefined
    >();
    type LiveSourceCtx = Parameters<
      Parameters<
        typeof import('./define-subscription.ts').defineSubscription<
          ReturnType<typeof within<AuthBase, typeof whenLive>>,
          {}
        >
      >[1]['source']
    >[1];
    expectTypeOf<Live<LiveSourceCtx>>().toExtend<
      LiveQueries<AuthBase, InAccounts | readonly [typeof import('./contracts.ts').contracts.live]>
    >();
    type AccountsSource = Parameters<
      Parameters<
        typeof import('./define-subscription.ts').defineSubscription<AccountsBase, {}>
      >[1]['source']
    >[1];
    expectTypeOf<Live<AccountsSource>>().toBeNever();
  });
});

describe('pure handlers (checklist 3)', () => {
  test('generator answers are typed per request; ctx.all answers a tuple', () => {
    defineCommand(authBase, {
      *decide(_input, ctx) {
        const bytes = yield* ctx.random(16);
        expectTypeOf(bytes).toEqualTypeOf<Uint8Array>();
        const [rows, ok, id] = yield* ctx.all([
          ctx.load.auth.credential.many({ where: { kind: 'password' } }),
          ctx.compute.argon2idVerify('v', 'p'),
          ctx.newId(credential),
        ]);
        expectTypeOf(rows).toEqualTypeOf<readonly CredentialRow[]>();
        expectTypeOf(ok).toEqualTypeOf<boolean>();
        expectTypeOf(id).toEqualTypeOf<Id<'auth.credential'>>();
        const profileRow = yield* ctx.load.accounts.ifPresent((a) =>
          a.profile.byId(id as string as Id<'accounts.profile'>),
        );
        expectTypeOf(profileRow?.displayName).toEqualTypeOf<string | undefined>();
        return [];
      },
    });
  });

  test('a bare yield and a yield of a request without * are rejected', () => {
    defineCommand(authBase, {
      // @ts-expect-error a bare yield yields undefined, not a pending request
      *decide() {
        yield;
        return [];
      },
    });
    defineCommand(authBase, {
      // @ts-expect-error a request must be delegated to with yield*
      *decide(_input, ctx) {
        yield ctx.random(4);
        return [];
      },
    });
  });

  test('an async handler is a compile error', () => {
    defineCommand(authBase, {
      // @ts-expect-error a Promise is not a decision
      decide: async () => [],
    });
    defineQuery(authBase, {
      // @ts-expect-error an async generator is not a handler
      async *read() {
        yield* [];
        return undefined;
      },
    });
  });

  test('entity commands receive the full current row and the target events', () => {
    defineCommand(authBase, credential, {
      decide: (_input, current, ctx) => {
        expectTypeOf(current.verifier).toEqualTypeOf<string>();
        expectTypeOf(ctx.events).toHaveProperty('revoked');
        expectTypeOf(ctx.write.auth.credential.revoked)
          .parameter(0)
          .toEqualTypeOf<Id<'auth.credential'> | CredentialRow>();
        return [ctx.events.revoked({ at: ctx.clock.now(), reason: undefined })];
      },
    });
  });

  test('prepare passes its value to decide; continuations are typed by outcomeOf', () => {
    expectTypeOf<NonNullable<(typeof recordOutcome)['~types']>['input']>().toEqualTypeOf<{
      readonly outcome: EffectOutcome<{ readonly status: number }>;
      readonly id: Id<'hooks.delivery'>;
      readonly ifVersion?: number;
    }>();
    defineCommand(hooksBase, {
      *prepare(_input, ctx) {
        return yield* ctx.perform(
          post({ url: ctx.config.endpoint, signingKey: ctx.config.signingKey, body: '' }),
        );
      },
      decide: (_input, ctx) => {
        expectTypeOf(ctx.prepared).toEqualTypeOf<EffectOutcome<{ readonly status: number }>>();
        return [];
      },
    });
    expectTypeOf(ctx(hooksBase).config.signingKey).toEqualTypeOf<SecretRef>();
    expectTypeOf<NonNullable<(typeof testEndpoint)['~types']>>().toEqualTypeOf<
      PartTypes<
        {},
        { readonly status?: number | undefined; readonly error?: string | undefined },
        never,
        never
      >
    >();
  });
});

describe('parts and mounts (checklist 1)', () => {
  test('a part is accepted only where its base and mount match', () => {
    // @ts-expect-error revoke is mounted on credential, not session
    defineModule(authBase, { entityActions: { session: { revoke } } });
    // @ts-expect-error revoke belongs to auth, not accounts
    defineModule(accountsBase, { entityActions: { profile: { revoke } } });
    // @ts-expect-error a module-level slot takes no entity action
    defineModule(authBase, { actions: { revoke } });
    defineModule(authBase, { entityActions: { credential: { revoke } } });
  });

  test('effects and executors are mounted by the generated manifest, each executor under its effect', () => {
    expectTypeOf(hooks).toEqualTypeOf<Hooks>();
    expectTypeOf<Hooks['actions']>().toHaveProperty('notify');
    expectTypeOf<Hooks['actions']>().toHaveProperty('testEndpoint');
    expectTypeOf<Hooks['entities']['delivery']['actions']>().toHaveProperty('recordOutcome');
    expectTypeOf<Hooks['effects']['post']>().toEqualTypeOf<typeof post>();
    expectTypeOf<Hooks['executors']['post']>().toEqualTypeOf<typeof postExecutor>();
    // @ts-expect-error executorsWithoutEffect: the executor of post mounted under another name
    defineModule(hooksBase, { effects: { post }, executors: { deliver: postExecutor } });
  });

  test('own actions are invoked by value with their typed input', () => {
    expectTypeOf<NonNullable<(typeof revoke)['~types']>['input']>().toEqualTypeOf<{
      readonly reason?: string | undefined;
      readonly id: Id<'auth.credential'>;
      readonly ifVersion?: number;
    }>();
  });
});

describe('policy typing (section 13.10)', () => {
  test('read rules list maskable fields only; write rules list any field', () => {
    defineRule(accountsBase, profile, { effect: 'allow', actions: ['read'], fields: ['email'] });
    defineRule(accountsBase, profile, {
      effect: 'allow',
      actions: ['read'],
      // @ts-expect-error displayName is not maskable
      fields: ['displayName'],
    });
    defineRule(accountsBase, profile, {
      effect: 'allow',
      actions: ['update'],
      fields: ['displayName', 'locale'],
    });
  });

  test('conditions name only fields and relations the rule can see; principal narrows', () => {
    defineRule(authBase, credential, {
      effect: 'allow',
      principal: 'user',
      where: (ctx) => ({ subject: ctx.principal.subject }),
    });
    defineRule(authBase, credential, {
      effect: 'allow',
      // @ts-expect-error without principal: 'user' the principal may have no subject
      where: (ctx) => ({ subject: ctx.principal.subject }),
    });
    // @ts-expect-error credential has no field 'owner'
    defineRule(authBase, credential, { effect: 'allow', where: () => ({ owner: 'x' }) });
    defineRule(within(authBase, toAccounts), 'profile', {
      effect: 'allow',
      principal: 'user',
      where: (ctx) => ({ credentials: { some: { subject: ctx.principal.subject } } }),
    });
    // @ts-expect-error the credentials relation is contributed, so it exists only within the contribution
    defineRule(accountsBase, profile, {
      effect: 'allow',
      where: () => ({ credentials: { some: {} } }),
    });
  });

  test('reactions name event references of present modules', () => {
    defineReaction(within(authBase, whenAccounts), {
      on: 'accounts.profile.deactivated',
      timing: 'inline',
      react: (event) => {
        expectTypeOf(event.state.id).toEqualTypeOf<Id<'accounts.profile'>>();
        expectTypeOf(event.data).toEqualTypeOf<{
          readonly at: Temporal.Instant;
          readonly reason?: string | undefined;
        }>();
        return [];
      },
    });
    // @ts-expect-error accounts is optional for auth outside the conditional part
    defineReaction(authBase, { on: 'accounts.profile.deactivated', react: () => [] });
    defineReaction(authBase, {
      on: 'auth.session.created',
      react: (event) => {
        expectTypeOf(event.current?.subject).toEqualTypeOf<SubjectId | undefined>();
        return [] as readonly Draft[];
      },
    });
  });

  test('entities and parts need no module value (decision 3b)', () => {
    const local = defineEntity({ prefix: 'loc', fields: { name: field.string() } });
    const localBase = defineModuleBase({ id: 'local', version: '0.1.0', entities: { local } });
    const rename = defineCommand(localBase, local, {
      input: shape({ name: field.string() }),
      decide: (input, current, ctx) => [
        ctx.write.local.local.update(current, { name: input.name }),
      ],
    });
    expectTypeOf(rename.mount).toEqualTypeOf<'local'>();
  });
});

declare function ctx<B extends AccountsBase | AuthBase | typeof hooksBase>(
  base: B,
): DecideContext<B>;
