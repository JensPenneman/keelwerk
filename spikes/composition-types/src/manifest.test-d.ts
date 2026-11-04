import { describe, expectTypeOf, test } from 'vitest';
import { defineCommand } from './define-command.ts';
import { defineEntity } from './define-entity.ts';
import { defineError } from './define-error.ts';
import { defineModule, type ModuleType } from './define-module.ts';
import { defineModuleBase, type ModuleBaseType } from './define-module-base.ts';
import { defineQuery } from './define-query.ts';
import { defineRule } from './define-rule.ts';
import { defineService } from './define-service.ts';
import { errors } from './errors.ts';
import { extensionPoint } from './extension-point.ts';
import { field } from './field.ts';
import type { IdentityProvider } from './fixtures/accounts/identity-provider.ts';
import type { Accounts } from './fixtures/accounts/module.generated.ts';
import { pageOf } from './page-of.ts';
import { shape } from './shape.ts';

// The accounts fixture written in one file: base, parts and a hand-written module literal (section 4.1).
const profile = defineEntity({
  prefix: 'prof',
  dataSubject: 'id',
  fields: {
    displayName: field.string({ maxLength: 120 }).merge('lww'),
    email: field
      .string({ format: 'email' })
      .unique()
      .personal({ queries: ['prefix'] })
      .maskable(),
    locale: field.string().optional(),
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
  extensionPoints: { identityProviders: extensionPoint<IdentityProvider>({ mode: 'set' }) },
  entities: { profile },
});
interface OneFileBase extends ModuleBaseType<typeof baseDef> {}
const base: OneFileBase = baseDef;
const emailTaken = defineError('accounts.email_taken', {
  kind: 'conflict',
  message: 'This e-mail address is already in use.',
  data: shape({ email: field.string() }),
});
const deactivate = defineCommand(base, profile, {
  input: shape({ reason: field.string().optional() }),
  decide: (input, _current, ctx) => [
    ctx.events.deactivated({ at: ctx.clock.now(), reason: input.reason }),
  ],
});
const search = defineQuery(base, profile, {
  input: shape({ text: field.string({ minLength: 3 }) }),
  output: pageOf(profile),
  read: (input, ctx) => ctx.target.query({ where: { displayName: { contains: input.text } } }),
});
const register = defineCommand(base, {
  input: shape({ displayName: field.string(), email: field.string({ format: 'email' }) }),
  output: shape({ profileId: field.ref.own('profile') }),
  errors: [emailTaken],
  auth: { public: true },
  *decide(input, ctx) {
    if (!ctx.config.allowSelfRegistration) throw errors.forbidden('Self-registration is disabled.');
    const id = yield* ctx.newId(profile);
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
const operator = defineRule(base, profile, {
  effect: 'allow',
  actions: ['*'],
  principal: 'operator',
});
const open = defineRule(base, register, { effect: 'allow', public: true });
const findByEmail = defineService(base, (own, email: string) =>
  own.load.accounts.profile.one({ where: { email } }),
);
const oneFileDef = defineModule(base, {
  actions: { register },
  services: { findByEmail },
  entityActions: { profile: { deactivate, search } },
  policies: { profile: { operator }, register: { open } },
});
interface OneFileAccounts extends ModuleType<typeof oneFileDef> {}

describe('the generated manifest (decision 59b, checklist 1)', () => {
  test('mounts the same normalised module as the module written in one file', () => {
    expectTypeOf<OneFileAccounts['entities']>().toEqualTypeOf<Accounts['entities']>();
    expectTypeOf<OneFileAccounts['actions']>().toEqualTypeOf<Accounts['actions']>();
    expectTypeOf<OneFileAccounts['services']>().toEqualTypeOf<Accounts['services']>();
    expectTypeOf<OneFileAccounts['contributes']>().toEqualTypeOf<Accounts['contributes']>();
    expectTypeOf<OneFileAccounts>().toEqualTypeOf<Accounts>();
  });
});
