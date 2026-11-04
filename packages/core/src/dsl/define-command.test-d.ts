import { describe, expectTypeOf, test } from 'vitest';
import type { revoke } from '../../test/fixtures/modules/auth/src/actions/credential/revoke.ts';
import { type AuthBase, authBase } from '../../test/fixtures/modules/auth/src/base.ts';
import { credential } from '../../test/fixtures/modules/auth/src/entities/credential.ts';
import type { recordOutcome } from '../../test/fixtures/modules/hooks/src/actions/delivery/record-outcome.ts';
import type { testEndpoint } from '../../test/fixtures/modules/hooks/src/actions/test-endpoint.ts';
import { hooksBase } from '../../test/fixtures/modules/hooks/src/base.ts';
import { post } from '../../test/fixtures/modules/hooks/src/effects/post.ts';
import type { DecideContext } from '../contexts/decide-context.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { Id } from '../ids/id.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import type { PartTypes } from '../model/action-part.ts';
import type { EffectOutcome } from '../model/effect-outcome.ts';
import type { Request } from '../protocol/request.ts';
import type { Empty } from '../types/empty.ts';
import { defineCommand } from './define-command.ts';
import { defineQuery } from './define-query.ts';
import { outcomeOf } from './outcome-of.ts';

type AuthCtx = DecideContext<AuthBase>;
type CredentialRow = NonNullable<
  ReturnType<AuthCtx['load']['auth']['credential']['byId']> extends Request<infer R> ? R : never
>;

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

  test('own actions are invoked by value with their typed input', () => {
    expectTypeOf<NonNullable<(typeof revoke)['~types']>['input']>().toEqualTypeOf<{
      readonly reason?: string | undefined;
      readonly id: Id<'auth.credential'>;
      readonly ifVersion?: number;
    }>();
  });
});

describe('prepare and continuations (section 7.9.4, S-05)', () => {
  test('prepare passes its value to decide on a sync command', () => {
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
    expectTypeOf<
      DecideContext<typeof hooksBase>['config']['signingKey']
    >().toEqualTypeOf<SecretRef>();
    expectTypeOf<NonNullable<(typeof testEndpoint)['~types']>>().toEqualTypeOf<
      PartTypes<
        Empty,
        { readonly status?: number | undefined; readonly error?: string | undefined },
        never,
        never
      >
    >();
  });

  test('prepare on an async or either command is a compile error', () => {
    defineCommand(hooksBase, {
      execution: 'sync',
      prepare: () => 1,
      decide: () => [],
    });
    defineCommand(hooksBase, {
      execution: 'async',
      // @ts-expect-error prepare exists only on execution: 'sync'
      prepare: () => 1,
      decide: () => [],
    });
    defineCommand(hooksBase, {
      execution: 'either',
      // @ts-expect-error prepare exists only on execution: 'sync'
      prepare: () => 1,
      decide: () => [],
    });
    defineCommand(hooksBase, { execution: 'async', decide: () => [] });
  });

  test('outcomeOf types the input of a continuation, with extra input from with (decision 97)', () => {
    expectTypeOf<NonNullable<(typeof recordOutcome)['~types']>['input']>().toEqualTypeOf<{
      readonly outcome: EffectOutcome<{ readonly status: number }>;
      readonly id: Id<'hooks.delivery'>;
      readonly ifVersion?: number;
    }>();
    const withDomain = defineCommand(hooksBase, {
      input: outcomeOf(post, shape({ domain: field.string() })),
      decide: (input) => {
        expectTypeOf(input.domain).toEqualTypeOf<string>();
        expectTypeOf(input.outcome).toEqualTypeOf<EffectOutcome<{ readonly status: number }>>();
        return [];
      },
    });
    expectTypeOf<NonNullable<(typeof withDomain)['~types']>['input']>().toHaveProperty('domain');
  });
});
