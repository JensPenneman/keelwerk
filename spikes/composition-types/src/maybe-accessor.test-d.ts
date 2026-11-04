import { describe, expectTypeOf, test } from 'vitest';
import type { DecideContext } from './decide-context.ts';
import type { AuthBase } from './fixtures/auth/base.ts';
import type { Id } from './id.ts';
import type { Maybe } from './loads-of.ts';
import type { Gen, Request } from './request.ts';

type Ctx = DecideContext<AuthBase>;
type AccountsLoads = Ctx['load']['accounts'] extends Maybe<infer L> ? L : never;
type Profile = ReturnType<AccountsLoads['profile']['byId']> extends Request<infer R> ? R : never;

/** The `| undefined` form of decision 32a, for comparison only: the optional module's loads may be absent. */
type UndefinedFormCtx = Omit<Ctx, 'load'> & {
  readonly load: Omit<Ctx['load'], 'accounts'> & { readonly accounts: AccountsLoads | undefined };
};

declare const id: Id<'accounts.profile'>;

describe('optional modules: the Maybe accessor against the | undefined form (decision 32b, section 26.2)', () => {
  test('the Maybe accessor is one request, answered with undefined when the module is absent', () => {
    function* read(ctx: Ctx): Gen<string | undefined> {
      const row = yield* ctx.load.accounts.ifPresent((a) => a.profile.byId(id));
      expectTypeOf(row).toEqualTypeOf<Profile | undefined>();
      const [maybeRow, bytes] = yield* ctx.all([
        ctx.load.accounts.ifPresent((a) => a.profile.byId(id)),
        ctx.random(4),
      ]);
      expectTypeOf(maybeRow).toEqualTypeOf<Profile | undefined>();
      expectTypeOf(bytes).toEqualTypeOf<Uint8Array>();
      return row?.displayName;
    }
    expectTypeOf(read).returns.toEqualTypeOf<Gen<string | undefined>>();
  });

  test('the | undefined form needs a branch per call site and cannot sit inside ctx.all', () => {
    function* read(ctx: UndefinedFormCtx): Gen<string | undefined> {
      const accounts = ctx.load.accounts;
      const row = accounts ? yield* accounts.profile.byId(id) : undefined;
      expectTypeOf(row).toEqualTypeOf<Profile | undefined>();
      // @ts-expect-error an absent module leaves undefined in the batch, which is not a request
      yield* ctx.all([accounts?.profile.byId(id), ctx.random(4)]);
      return row?.displayName;
    }
    expectTypeOf(read).returns.toEqualTypeOf<Gen<string | undefined>>();
  });
});
