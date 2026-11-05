import type { ActionRef, AppActionTree, Row } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { Portal } from './app.ts';
import type {
  Actions,
  App,
  Client,
  Entities,
  ActionRef as GeneratedActionRef,
  RowOf,
} from './keelwerk.generated.ts';

describe('the portal app', () => {
  test('folds accounts and auth: the profile, the credential and the auth actions exist', () => {
    expectTypeOf<Row<Portal, 'accounts.profile'>['displayName']>().not.toBeNever();
    expectTypeOf<Row<Portal, 'auth.credential'>['identifier']>().not.toBeNever();
    expectTypeOf<'auth.signUp'>().toExtend<ActionRef<Portal>>();
    expectTypeOf<'auth.login'>().toExtend<ActionRef<Portal>>();
    expectTypeOf<'auth.logout'>().toExtend<ActionRef<Portal>>();
    expectTypeOf<'accounts.register'>().toExtend<ActionRef<Portal>>();
  });

  test('login and sign-up run in the request, logout too', () => {
    expectTypeOf<
      AppActionTree<Portal>['auth']['actions']['login']['execution']
    >().toEqualTypeOf<'sync'>();
    expectTypeOf<
      AppActionTree<Portal>['auth']['actions']['logout']['execution']
    >().toEqualTypeOf<'sync'>();
  });

  test('its generated file folds the same app type', () => {
    expectTypeOf<App>().toEqualTypeOf<Portal>();
    expectTypeOf<GeneratedActionRef>().toExtend<string>();
    expectTypeOf<keyof Entities>().toExtend<string>();
    expectTypeOf<keyof Actions>().toExtend<string>();
    expectTypeOf<RowOf<'accounts.profile'>>().toExtend<object>();
    expectTypeOf<Client>().toHaveProperty('invoke');
  });
});
