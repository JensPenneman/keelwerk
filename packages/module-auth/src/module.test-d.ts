import { defineApp, defineModule } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import type { ExpectValidApp, HasAction, HasEntity } from '@keelwerk/testing/types';
import { describe, expectTypeOf, test } from 'vitest';
import { revoke as credentialRevoke } from './actions/credential/revoke.ts';
import { extendSession } from './actions/extend-session.ts';
import { login } from './actions/login.ts';
import { logout } from './actions/logout.ts';
import { revokeSubject } from './actions/revoke-subject.ts';
import { revoke as sessionRevoke } from './actions/session/revoke.ts';
import { signUp } from './actions/sign-up.ts';
import { whoami } from './actions/whoami.ts';
import { authBase } from './base.ts';
import { invocationMiddlewareFill } from './contributions/to-core/fills/invocation-middleware.ts';
import { principalResolversFill } from './contributions/to-core/fills/principal-resolvers.ts';
import { reauthenticationRequired } from './errors/reauthentication-required.ts';
import { onTenantCreated } from './lifecycle/on-tenant-created.ts';
import { type Auth, auth } from './module.generated.ts';
import { alreadyRevoked } from './policies/credential/already-revoked.ts';
import { self } from './policies/credential/self.ts';
import { selfRevoke } from './policies/credential/self-revoke.ts';
import { signedIn as extendSessionSignedIn } from './policies/extend-session/signed-in.ts';
import { open as loginOpen } from './policies/login/open.ts';
import { signedIn as logoutSignedIn } from './policies/logout/signed-in.ts';
import { selfSessions } from './policies/session/self-sessions.ts';
import { open as signUpOpen } from './policies/sign-up/open.ts';
import { signedIn as whoamiSignedIn } from './policies/whoami/signed-in.ts';
import { hashPassword } from './services/hash-password.ts';
import { verifyPassword } from './services/verify-password.ts';

describe('the auth manifest', () => {
  test('has the type of the same module written in one file', () => {
    const written = defineModule(authBase, {
      actions: { extendSession, login, logout, revokeSubject, signUp, whoami },
      entityActions: {
        credential: { revoke: credentialRevoke },
        session: { revoke: sessionRevoke },
      },
      policies: {
        credential: { alreadyRevoked, self, selfRevoke },
        extendSession: { signedIn: extendSessionSignedIn },
        login: { open: loginOpen },
        logout: { signedIn: logoutSignedIn },
        session: { selfSessions },
        signUp: { open: signUpOpen },
        whoami: { signedIn: whoamiSignedIn },
      },
      services: { hashPassword, verifyPassword },
      contributes: {
        toCore: {
          extensionPoints: {
            invocationMiddleware: invocationMiddlewareFill,
            principalResolvers: principalResolversFill,
          },
        },
      },
      lifecycle: { onTenantCreated },
      migrations: new URL('../migrations/', import.meta.url),
    });
    // The contribution to the core carries the core's whole type, which a deep equality of the two modules cannot compare; the mounts are.
    expectTypeOf<keyof Auth['actions']>().toEqualTypeOf<keyof (typeof written)['actions']>();
    expectTypeOf<keyof Auth['policies']>().toEqualTypeOf<keyof (typeof written)['policies']>();
    expectTypeOf<keyof Auth['services']>().toEqualTypeOf<keyof (typeof written)['services']>();
    expectTypeOf<Auth['actions']['login']>().toEqualTypeOf<(typeof written)['actions']['login']>();
  });

  test('alone', () => {
    const app = defineApp({ id: 'alone', modules: [auth] as const });
    expectTypeOf<ExpectValidApp<typeof app>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'auth.credential'>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'auth.session'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'auth.signUp'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'auth.login'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'auth.session.revoke'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'auth.requestPasswordReset'>>().toEqualTypeOf<false>();
  });

  test('with accounts', () => {
    const app = defineApp({ id: 'both', modules: [accounts, auth] as const });
    expectTypeOf<ExpectValidApp<typeof app>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'accounts.profile'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'auth.whoami'>>().toEqualTypeOf<true>();
  });

  test('re-authentication has its own error code', () => {
    expectTypeOf(reauthenticationRequired.code).toEqualTypeOf<'auth.reauthentication_required'>();
  });
});
