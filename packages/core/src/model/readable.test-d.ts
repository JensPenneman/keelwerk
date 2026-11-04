import { describe, expectTypeOf, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { defineApp } from '../dsl/define-app.ts';
import type { Id } from '../ids/id.ts';
import type { AppActionTree } from './app-action-tree.ts';
import type { Readable } from './readable.ts';
import type { Row } from './row.ts';

const app = defineApp({ id: 'readable', modules: [accounts, auth] });
type Portal = typeof app;

describe('Readable<App, Ref> (decision 94, section 8.1)', () => {
  test('maskable fields are optional, other fields keep their row type', () => {
    expectTypeOf<Readable<Portal, 'accounts.profile'>['email']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<Row<Portal, 'accounts.profile'>['email']>().toEqualTypeOf<string>();
    expectTypeOf<Readable<Portal, 'accounts.profile'>['displayName']>().toEqualTypeOf<string>();
    expectTypeOf<Readable<Portal, 'accounts.profile'>['id']>().toEqualTypeOf<
      Id<'accounts.profile'>
    >();
  });

  test('hidden fields never appear, in any view', () => {
    expectTypeOf<Readable<Portal, 'auth.credential'>>().not.toHaveProperty('verifier');
    expectTypeOf<Row<Portal, 'auth.credential'>>().not.toHaveProperty('verifier');
  });

  test('contributed fields are part of the readable row', () => {
    expectTypeOf<Readable<Portal, 'accounts.profile'>>().toHaveProperty('lastLoginAt');
    expectTypeOf<Readable<Portal, 'accounts.profile'>>().not.toHaveProperty('defaultTeamName');
  });

  test('an unknown reference is never', () => {
    expectTypeOf<Readable<Portal, 'nope'>>().toBeNever();
  });

  test('the action tree returns readable rows', () => {
    type Tree = AppActionTree<Portal>;
    expectTypeOf<Tree['accounts']['entities']['profile']['create']['output']>().toEqualTypeOf<
      Readable<Portal, 'accounts.profile'>
    >();
  });
});
