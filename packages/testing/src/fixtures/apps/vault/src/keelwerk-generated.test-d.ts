import { describe, expectTypeOf, test } from 'vitest';
import type { Vault } from './app.ts';
import type { ActionRef, Actions, App, Client, Entities, RowOf } from './keelwerk.generated.ts';

describe('the generated file of the vault fixture app (section 13.7)', () => {
  test('re-exports the app type fold with the secret requests of the vault module', () => {
    expectTypeOf<App>().toEqualTypeOf<Vault>();
    expectTypeOf<'vault.store' | 'vault.replace' | 'vault.retire'>().toExtend<ActionRef>();
    expectTypeOf<RowOf<'vault.credential'>>().toExtend<object>();
    expectTypeOf<keyof Entities>().toExtend<string>();
    expectTypeOf<keyof Actions>().toExtend<string>();
    expectTypeOf<Client>().toHaveProperty('invoke');
  });
});
