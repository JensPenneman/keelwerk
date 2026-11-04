// Generated from the module's directories (decision 59b); do not edit.
import { defineModule, type ModuleType } from '../../define-module.ts';
import { login as actionsLogin } from './actions/login.ts';
import { revokeSubject as actionsRevokeSubject } from './actions/revoke-subject.ts';
import { whoami as actionsWhoami } from './actions/whoami.ts';
import { authBase } from './base.ts';
import { linkProfile as conditionalWhenAccountsActionsLinkProfile } from './conditional/when-accounts/actions/link-profile.ts';
import { revokeOnDeactivation as conditionalWhenAccountsReactionsRevokeOnDeactivation } from './conditional/when-accounts/reactions/revoke-on-deactivation.ts';
import { sessionEvents as conditionalWhenLiveActionsSessionEvents } from './conditional/when-live/actions/session-events.ts';
import { whoami as contributionsToAccountsActionsWhoami } from './contributions/to-accounts/actions/whoami.ts';
import { resetPassword as contributionsToAccountsEntityActionsProfileResetPassword } from './contributions/to-accounts/entity-actions/profile/reset-password.ts';
import { identityProviders as contributionsToAccountsFillsIdentityProviders } from './contributions/to-accounts/fills/identity-providers.ts';
import { self as contributionsToAccountsPoliciesProfileSelf } from './contributions/to-accounts/policies/profile/self.ts';
import { revoke as entityActionsCredentialRevoke } from './entity-actions/credential/revoke.ts';
import { self as policiesCredentialSelf } from './policies/credential/self.ts';
import { open as policiesLoginOpen } from './policies/login/open.ts';

const moduleDef = defineModule(authBase, {
  actions: {
    login: actionsLogin,
    revokeSubject: actionsRevokeSubject,
    whoami: actionsWhoami,
  },
  entityActions: {
    credential: {
      revoke: entityActionsCredentialRevoke,
    },
  },
  policies: {
    credential: {
      self: policiesCredentialSelf,
    },
    login: {
      open: policiesLoginOpen,
    },
  },
  contributes: {
    toAccounts: {
      actions: {
        whoami: contributionsToAccountsActionsWhoami,
      },
      extensionPoints: {
        identityProviders: contributionsToAccountsFillsIdentityProviders,
      },
      entityActions: {
        profile: {
          resetPassword: contributionsToAccountsEntityActionsProfileResetPassword,
        },
      },
      policies: {
        profile: {
          self: contributionsToAccountsPoliciesProfileSelf,
        },
      },
    },
  },
  conditional: {
    whenAccounts: {
      actions: {
        linkProfile: conditionalWhenAccountsActionsLinkProfile,
      },
      reactions: {
        revokeOnDeactivation: conditionalWhenAccountsReactionsRevokeOnDeactivation,
      },
    },
    whenLive: {
      actions: {
        sessionEvents: conditionalWhenLiveActionsSessionEvents,
      },
    },
  },
});

/** The auth module. */
export interface Auth extends ModuleType<typeof moduleDef> {}

/** The auth module value. */
export const auth: Auth = moduleDef;
