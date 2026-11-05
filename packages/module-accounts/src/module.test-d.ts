import { defineApp, defineModule } from '@keelwerk/core';
import type { ExpectValidApp, HasAction, HasEntity } from '@keelwerk/testing/types';
import { describe, expectTypeOf, test } from 'vitest';
import { identities } from './actions/identities.ts';
import { deactivate } from './actions/profile/deactivate.ts';
import { search } from './actions/profile/search.ts';
import { register } from './actions/register.ts';
import { accountsBase } from './base.ts';
import { type Accounts, accounts } from './module.generated.ts';
import { signedIn } from './policies/identities/signed-in.ts';
import { directory } from './policies/profile/directory.ts';
import { frozen } from './policies/profile/frozen.ts';
import { operator } from './policies/profile/operator.ts';
import { open } from './policies/register/open.ts';
import { operator as registerOperator } from './policies/register/operator.ts';
import { findByEmail } from './services/find-by-email.ts';
import { registrationOpen } from './services/registration-open.ts';

describe('the accounts manifest', () => {
  test('has the type of the same module written in one file', () => {
    const written = defineModule(accountsBase, {
      actions: { identities, register },
      entityActions: { profile: { deactivate, search } },
      policies: {
        identities: { signedIn },
        profile: { directory, frozen, operator },
        register: { open, operator: registerOperator },
      },
      services: { findByEmail, registrationOpen },
      migrations: new URL('../migrations/', import.meta.url),
    });
    expectTypeOf<Accounts>().toEqualTypeOf<typeof written>();
  });

  test('alone', () => {
    const app = defineApp({ id: 'alone', modules: [accounts] as const });
    expectTypeOf<ExpectValidApp<typeof app>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'accounts.profile'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'accounts.register'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'accounts.profile.search'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'accounts.profile.changePassword'>>().toEqualTypeOf<false>();
  });
});
