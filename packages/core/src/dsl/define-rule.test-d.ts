import { describe, expectTypeOf, test } from 'vitest';
import { accountsBase } from '../../test/fixtures/modules/accounts/src/base.ts';
import { profile } from '../../test/fixtures/modules/accounts/src/entities/profile.ts';
import { authBase } from '../../test/fixtures/modules/auth/src/base.ts';
import { whenAccounts } from '../../test/fixtures/modules/auth/src/conditional/when-accounts/condition.ts';
import { toAccounts } from '../../test/fixtures/modules/auth/src/contributions/to-accounts/contribution.ts';
import { credential } from '../../test/fixtures/modules/auth/src/entities/credential.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { Id } from '../ids/id.ts';
import type { SubjectId } from '../ids/subject-id.ts';
import type { Draft } from '../protocol/draft.ts';
import { defineCommand } from './define-command.ts';
import { defineEntity } from './define-entity.ts';
import { defineModuleBase } from './define-module-base.ts';
import { defineReaction } from './define-reaction.ts';
import { defineRule } from './define-rule.ts';
import { within } from './within.ts';

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

  test('principal narrows ctx.principal', () => {
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
  });

  test('unknownConditionFields: a passing and a failing case (decision 99)', () => {
    defineRule(authBase, credential, {
      effect: 'allow',
      where: () => ({ revokedAt: { isNull: true } }),
    });
    defineRule(authBase, credential, {
      effect: 'allow',
      where: () => ({
        or: [{ revokedAt: { isNull: true } }, { not: { lastUsedAt: { isNull: true } } }],
      }),
    });
    // @ts-expect-error unknownConditionFields: credential has no field 'owner'
    defineRule(authBase, credential, { effect: 'allow', where: () => ({ owner: 'x' }) });
    // @ts-expect-error unknownConditionFields: the check reaches into or
    defineRule(authBase, credential, { effect: 'allow', where: () => ({ or: [{ owner: 'x' }] }) });
    // @ts-expect-error unknownConditionFields: and into check conditions
    defineRule(authBase, credential, { effect: 'allow', check: () => ({ nope: 1 }) });
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

  test('a rule over a module-level action takes the action part', () => {
    const touch = defineCommand(authBase, { decide: () => [] });
    const rule = defineRule(authBase, touch, { effect: 'allow', public: true });
    expectTypeOf(rule.kind).toEqualTypeOf<'rule'>();
    expectTypeOf(rule.target).toEqualTypeOf<typeof touch>();
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
