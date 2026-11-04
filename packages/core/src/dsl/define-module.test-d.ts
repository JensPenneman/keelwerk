import { describe, expectTypeOf, test } from 'vitest';
import { accountsBase } from '../../test/fixtures/modules/accounts/src/base.ts';
import type { profile } from '../../test/fixtures/modules/accounts/src/entities/profile.ts';
import type { IdentityProvider } from '../../test/fixtures/modules/accounts/src/extension-points/identity-provider.ts';
import type { Accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { revoke } from '../../test/fixtures/modules/auth/src/actions/credential/revoke.ts';
import { login } from '../../test/fixtures/modules/auth/src/actions/login.ts';
import { logout } from '../../test/fixtures/modules/auth/src/actions/logout.ts';
import { authBase } from '../../test/fixtures/modules/auth/src/base.ts';
import { toAccounts } from '../../test/fixtures/modules/auth/src/contributions/to-accounts/contribution.ts';
import { credential } from '../../test/fixtures/modules/auth/src/entities/credential.ts';
import { self as credentialSelf } from '../../test/fixtures/modules/auth/src/policies/credential/self.ts';
import { open as loginOpen } from '../../test/fixtures/modules/auth/src/policies/login/open.ts';
import { hooksBase } from '../../test/fixtures/modules/hooks/src/base.ts';
import { post } from '../../test/fixtures/modules/hooks/src/effects/post.ts';
import { post as postExecutor } from '../../test/fixtures/modules/hooks/src/executors/post.ts';
import { type Hooks, hooks } from '../../test/fixtures/modules/hooks/src/module.generated.ts';
import { defineError } from '../errors/define-error.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { AnyModule } from '../model/any-module.ts';
import type { ModuleBaseType } from '../model/module-base-type.ts';
import type { ModuleType } from '../model/module-type.ts';
import { defineCommand } from './define-command.ts';
import { defineEntity } from './define-entity.ts';
import { defineModule } from './define-module.ts';
import { defineModuleBase } from './define-module-base.ts';
import { defineQuery } from './define-query.ts';
import { defineRule } from './define-rule.ts';
import { defineService } from './define-service.ts';
import { extensionPoint } from './extension-point.ts';
import { pageOf } from './page-of.ts';
import { within } from './within.ts';

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
  });

  test('executorsWithoutEffect: a passing and a failing case', () => {
    defineModule(hooksBase, { effects: { post }, executors: { post: postExecutor } });
    // @ts-expect-error executorsWithoutEffect: the executor of post mounted under another name
    defineModule(hooksBase, { effects: { post }, executors: { deliver: postExecutor } });
    // @ts-expect-error executorsWithoutEffect: an executor with no effect mounted at all
    defineModule(hooksBase, { executors: { post: postExecutor } });
  });
});

describe('the module checks of defineModule (decision 105)', () => {
  const touch = defineCommand(authBase, { decide: () => [] });
  const revokeRule = defineRule(authBase, credential, {
    effect: 'allow',
    actions: ['revoke'],
    principal: 'user',
  });
  const typoRule = defineRule(authBase, credential, {
    effect: 'allow',
    actions: ['revok'],
    principal: 'user',
  });
  const readRule = defineRule(authBase, credential, {
    effect: 'allow',
    actions: ['read', 'update'],
  });

  test('unknownRuleActions: custom action names must be mounted on the target', () => {
    defineModule(authBase, {
      entityActions: { credential: { revoke } },
      policies: { credential: { revokeRule, readRule } },
    });
    // @ts-expect-error unknownRuleActions: 'revok' is not an action of credential
    defineModule(authBase, {
      entityActions: { credential: { revoke } },
      policies: { credential: { typoRule } },
    });
    // @ts-expect-error unknownRuleActions: revoke is not mounted, so the rule names an unknown action
    defineModule(authBase, {
      policies: { credential: { revokeRule } },
    });
  });

  test('unknownPolicyTargets: the policy key must be the target the rule covers', () => {
    defineModule(authBase, {
      actions: { login },
      entityActions: { credential: { revoke } },
      policies: { credential: { self: credentialSelf }, login: { open: loginOpen } },
    });
    // @ts-expect-error unknownPolicyTargets: the rule covers credential, not session
    defineModule(authBase, {
      entityActions: { credential: { revoke } },
      policies: { session: { self: credentialSelf } },
    });
    // @ts-expect-error unknownPolicyTargets: the rule covers login, not logout
    defineModule(authBase, {
      actions: { login, logout },
      policies: { logout: { open: loginOpen } },
    });
    // @ts-expect-error unknownPolicyTargets: the action the rule covers is not mounted under that key
    defineModule(authBase, {
      policies: { touch: { rule: defineRule(authBase, touch, { effect: 'allow', public: true }) } },
    });
  });

  test('a contribution section is checked as well', () => {
    const onProfile = defineRule(within(authBase, toAccounts), 'profile', { effect: 'allow' });
    defineModule(authBase, {
      contributes: { toAccounts: { policies: { profile: { onProfile } } } },
    });
    // @ts-expect-error unknownPolicyTargets: the rule covers profile
    defineModule(authBase, {
      contributes: { toAccounts: { policies: { session: { onProfile } } } },
    });
  });
});

describe('the generated manifest (decision 59b, checklist 1)', () => {
  // The accounts fixture written in one file: base, parts and a hand-written module literal (section 4.1).
  const profileDef = defineEntity({
    prefix: 'prof',
    dataSubject: 'id',
    fields: {
      displayName: field.string({ maxLength: 120 }).merge('lww'),
      email: field
        .string({ format: 'email' })
        .unique()
        .personal({ normalize: 'email', queries: ['prefix'] })
        .maskable(),
      locale: field.string().default('nl-BE'),
      deactivatedAt: field.instant().optional(),
    },
    indexes: [{ fields: ['displayName'] }],
    events: { deactivated: shape({ at: field.instant(), reason: field.string().optional() }) },
    evolve: { deactivated: (state, event) => ({ ...state, deactivatedAt: event.at }) },
  });
  const baseDef = defineModuleBase({
    id: 'accounts',
    version: '0.1.0',
    config: shape({ allowSelfRegistration: field.boolean().default(false) }),
    extensionPoints: { identityProviders: extensionPoint.set<IdentityProvider>() },
    entities: { profile: profileDef },
  });
  interface OneFileBase extends ModuleBaseType<typeof baseDef> {}
  const base: OneFileBase = baseDef;
  const emailTaken = defineError('accounts.email_taken', {
    kind: 'conflict',
    message: 'This e-mail address is already in use.',
    data: shape({ email: field.string() }),
  });
  const deactivate = defineCommand(base, profileDef, {
    input: shape({ reason: field.string().optional() }),
    decide: (input, _current, ctx) => [
      ctx.events.deactivated({ at: ctx.clock.now(), reason: input.reason }),
    ],
  });
  const search = defineQuery(base, profileDef, {
    input: shape({ text: field.string({ minLength: 3 }) }),
    output: pageOf(profileDef),
    read: (input, ctx) => ctx.target.query({ where: { displayName: { contains: input.text } } }),
  });
  const register = defineCommand(base, {
    input: shape({ displayName: field.string(), email: field.string({ format: 'email' }) }),
    output: shape({ profileId: field.ref.own('profile') }),
    errors: [emailTaken],
    auth: { public: true },
    *decide(input, ctx) {
      const id = yield* ctx.newId(profileDef);
      return {
        events: [
          ctx.write.accounts.profile.create({
            id,
            displayName: input.displayName,
            email: input.email,
          }),
        ],
        result: { profileId: id },
      };
    },
  });
  const operator = defineRule(base, profileDef, {
    effect: 'allow',
    actions: ['*'],
    principal: 'operator',
  });
  const findByEmail = defineService(base, (own, email: string) =>
    own.load.accounts.profile.one({ where: { email } }),
  );
  const oneFileDef = defineModule(base, {
    actions: { register },
    services: { findByEmail },
    entityActions: { profile: { deactivate, search } },
    policies: { profile: { operator } },
  });
  interface OneFileAccounts extends ModuleType<typeof oneFileDef> {}

  test('the fixture module is an AnyModule and mounts what the one-file module mounts', () => {
    expectTypeOf<Accounts>().toExtend<AnyModule>();
    expectTypeOf<OneFileAccounts['actions']['register']['kind']>().toEqualTypeOf<
      Accounts['actions']['register']['kind']
    >();
    expectTypeOf<keyof OneFileAccounts['entities']['profile']['actions']>().toEqualTypeOf<
      keyof Accounts['entities']['profile']['actions']
    >();
    expectTypeOf<keyof OneFileAccounts['services']>().toEqualTypeOf<keyof Accounts['services']>();
    expectTypeOf<OneFileAccounts['contributes']>().toEqualTypeOf<Accounts['contributes']>();
  });

  test('the constraints never mention any (a single any would collapse UnionToIntersection)', () => {
    expectTypeOf<AnyModule>().not.toBeAny();
    expectTypeOf<NonNullable<AnyModule['entities']>[string]>().not.toBeAny();
    expectTypeOf<NonNullable<AnyModule['contributes']>[number]>().not.toBeAny();
    expectTypeOf<NonNullable<AnyModule['actions']>[string]['~types']>().not.toBeAny();
  });

  test('entities are named types (decision 103)', () => {
    expectTypeOf<Accounts['entities']['profile']>().toExtend<typeof profile>();
  });
});
