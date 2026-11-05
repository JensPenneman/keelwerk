import { contracts, defineApp, defineModule, defineModuleBase, type Row } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import type { ExpectValidApp, HasAction, HasEntity } from '@keelwerk/testing/types';
import { describe, expectTypeOf, test } from 'vitest';
import { revoke as credentialRevoke } from './actions/credential/revoke.ts';
import { extendSession } from './actions/extend-session.ts';
import { issueResetLink } from './actions/issue-reset-link.ts';
import { login } from './actions/login.ts';
import { logout } from './actions/logout.ts';
import { reauthenticate } from './actions/reauthenticate.ts';
import { requestPasswordReset } from './actions/request-password-reset.ts';
import { resetPassword } from './actions/reset-password.ts';
import { revokeSubject } from './actions/revoke-subject.ts';
import { revoke as sessionRevoke } from './actions/session/revoke.ts';
import { signUp } from './actions/sign-up.ts';
import { whoami } from './actions/whoami.ts';
import { authBase } from './base.ts';
import { linkProfile } from './conditional/when-accounts/reactions/link-profile.ts';
import { recordLogin } from './conditional/when-accounts/reactions/record-login.ts';
import { registerProfile } from './conditional/when-accounts/reactions/register-profile.ts';
import { revokeOnDeactivation } from './conditional/when-accounts/reactions/revoke-on-deactivation.ts';
import { syncIdentifier } from './conditional/when-accounts/reactions/sync-identifier.ts';
import { sessionEvents } from './conditional/when-live/actions/session-events.ts';
import { signedIn as liveSessionEventsSignedIn } from './conditional/when-live/policies/session-events/signed-in.ts';
import { changePassword } from './contributions/to-accounts/actions/profile/change-password.ts';
import { identityProvidersFill } from './contributions/to-accounts/fills/identity-providers.ts';
import { self as accountsProfileSelf } from './contributions/to-accounts/policies/profile/self.ts';
import { selfEdit } from './contributions/to-accounts/policies/profile/self-edit.ts';
import { selfPassword } from './contributions/to-accounts/policies/profile/self-password.ts';
import { sharedCredential } from './contributions/to-accounts/policies/profile/shared-credential.ts';
import { invocationMiddlewareFill } from './contributions/to-core/fills/invocation-middleware.ts';
import { principalResolversFill } from './contributions/to-core/fills/principal-resolvers.ts';
import { reauthenticationRequired } from './errors/reauthentication-required.ts';
import { resetTokenInvalid } from './errors/reset-token-invalid.ts';
import { onTenantCreated } from './lifecycle/on-tenant-created.ts';
import { type Auth, auth } from './module.generated.ts';
import { alreadyRevoked } from './policies/credential/already-revoked.ts';
import { self as credentialSelf } from './policies/credential/self.ts';
import { selfRevoke } from './policies/credential/self-revoke.ts';
import { signedIn as extendSessionSignedIn } from './policies/extend-session/signed-in.ts';
import { operator } from './policies/issue-reset-link/operator.ts';
import { open as loginOpen } from './policies/login/open.ts';
import { signedIn as logoutSignedIn } from './policies/logout/signed-in.ts';
import { signedIn as reauthenticateSignedIn } from './policies/reauthenticate/signed-in.ts';
import { open as requestPasswordResetOpen } from './policies/request-password-reset/open.ts';
import { open as resetPasswordOpen } from './policies/reset-password/open.ts';
import { selfSessions } from './policies/session/self-sessions.ts';
import { open as signUpOpen } from './policies/sign-up/open.ts';
import { signedIn as whoamiSignedIn } from './policies/whoami/signed-in.ts';
import { hashPassword } from './services/hash-password.ts';
import { verifyPassword } from './services/verify-password.ts';

describe('the auth manifest', () => {
  test('has the type of the same module written in one file', () => {
    const written = defineModule(authBase, {
      actions: {
        extendSession,
        issueResetLink,
        login,
        logout,
        reauthenticate,
        requestPasswordReset,
        resetPassword,
        revokeSubject,
        signUp,
        whoami,
      },
      entityActions: {
        credential: { revoke: credentialRevoke },
        session: { revoke: sessionRevoke },
      },
      policies: {
        credential: { alreadyRevoked, self: credentialSelf, selfRevoke },
        extendSession: { signedIn: extendSessionSignedIn },
        issueResetLink: { operator },
        login: { open: loginOpen },
        logout: { signedIn: logoutSignedIn },
        reauthenticate: { signedIn: reauthenticateSignedIn },
        requestPasswordReset: { open: requestPasswordResetOpen },
        resetPassword: { open: resetPasswordOpen },
        session: { selfSessions },
        signUp: { open: signUpOpen },
        whoami: { signedIn: whoamiSignedIn },
      },
      services: { hashPassword, verifyPassword },
      contributes: {
        toAccounts: {
          entityActions: { profile: { changePassword } },
          policies: {
            profile: { self: accountsProfileSelf, selfEdit, selfPassword, sharedCredential },
          },
          extensionPoints: { identityProviders: identityProvidersFill },
        },
        toCore: {
          extensionPoints: {
            invocationMiddleware: invocationMiddlewareFill,
            principalResolvers: principalResolversFill,
          },
        },
      },
      conditional: {
        whenAccounts: {
          reactions: {
            linkProfile,
            recordLogin,
            registerProfile,
            revokeOnDeactivation,
            syncIdentifier,
          },
        },
        whenLive: {
          actions: { sessionEvents },
          policies: { sessionEvents: { signedIn: liveSessionEventsSignedIn } },
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

  test('auth alone', () => {
    const app = defineApp({ id: 'alone', modules: [auth] as const });
    expectTypeOf<ExpectValidApp<typeof app>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'auth.credential'>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'auth.session'>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'auth.resetToken'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'auth.signUp'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'auth.login'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'auth.session.revoke'>>().toEqualTypeOf<true>();
    expectTypeOf<
      HasAction<
        typeof app,
        | 'auth.reauthenticate'
        | 'auth.requestPasswordReset'
        | 'auth.resetPassword'
        | 'auth.issueResetLink'
      >
    >().toEqualTypeOf<true>();
    // Nothing of the contribution to accounts exists without accounts.
    expectTypeOf<HasAction<typeof app, 'accounts.profile.changePassword'>>().toEqualTypeOf<false>();
    expectTypeOf<HasEntity<typeof app, 'accounts.profile'>>().toEqualTypeOf<false>();
  });

  test('accounts alone', () => {
    const app = defineApp({ id: 'accounts-alone', modules: [accounts] as const });
    expectTypeOf<ExpectValidApp<typeof app>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'accounts.profile'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'accounts.profile.changePassword'>>().toEqualTypeOf<false>();
    expectTypeOf<HasAction<typeof app, 'auth.signUp'>>().toEqualTypeOf<false>();
  });

  test('both', () => {
    const app = defineApp({ id: 'both', modules: [accounts, auth] as const });
    expectTypeOf<ExpectValidApp<typeof app>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'accounts.profile'>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof app, 'auth.credential'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'auth.whoami'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'accounts.profile.changePassword'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof app, 'accounts.register'>>().toEqualTypeOf<true>();
  });

  test('the optional parts toggle with the modules that select them', () => {
    const alone = defineApp({ id: 'alone', modules: [auth] as const });
    const only = defineApp({ id: 'accounts-only', modules: [accounts] as const });
    const both = defineApp({ id: 'both', modules: [accounts, auth] as const });
    const source = defineModule(
      defineModuleBase({ id: 'live-source', version: '0.0.0', provides: [contracts.live] }),
      {},
    );
    const live = defineApp({ id: 'live', modules: [source, auth] as const });
    type Has<Row, Key extends string> = Key extends keyof Row ? true : false;
    expectTypeOf<Has<Row<typeof alone, 'auth.credential'>, 'profileId'>>().toEqualTypeOf<false>();
    expectTypeOf<Has<Row<typeof both, 'auth.credential'>, 'profileId'>>().toEqualTypeOf<true>();
    expectTypeOf<Has<Row<typeof only, 'accounts.profile'>, 'lastLoginAt'>>().toEqualTypeOf<false>();
    expectTypeOf<
      Has<Row<typeof only, 'accounts.profile'>, 'emailVerifiedAt'>
    >().toEqualTypeOf<false>();
    expectTypeOf<Has<Row<typeof both, 'accounts.profile'>, 'lastLoginAt'>>().toEqualTypeOf<true>();
    expectTypeOf<
      Has<Row<typeof both, 'accounts.profile'>, 'emailVerifiedAt'>
    >().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof alone, 'auth.sessionEvents'>>().toEqualTypeOf<false>();
    expectTypeOf<HasAction<typeof live, 'auth.sessionEvents'>>().toEqualTypeOf<true>();
  });

  test('re-authentication and reset have their own error codes', () => {
    expectTypeOf(reauthenticationRequired.code).toEqualTypeOf<'auth.reauthentication_required'>();
    expectTypeOf(resetTokenInvalid.code).toEqualTypeOf<'auth.reset_token_invalid'>();
  });
});
