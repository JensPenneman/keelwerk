import { describe, expect, it } from 'vitest';
import { revoke } from '../../test/fixtures/modules/auth/src/actions/credential/revoke.ts';
import { authBase } from '../../test/fixtures/modules/auth/src/base.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { defineModule } from './define-module.ts';

describe('the module value of the auth fixture', () => {
  const toAccounts = auth.contributes.find((entry) => entry.key === 'toAccounts');
  const whenAccounts = auth.conditional.find((entry) => entry.key === 'whenAccounts');

  it('carries a contributed entity action under the patched entity', () => {
    const profile = toAccounts?.entities.profile;
    expect(Object.keys(profile?.actions ?? {})).toEqual(['resetPassword']);
    expect(Object.keys(profile?.fields ?? {})).toEqual(['lastLoginAt', 'lastCredentialId']);
    expect(profile?.actions.resetPassword.ref).toBe('accounts.profile.resetPassword');
  });

  it('carries policies, reactions and fills of contributed and conditional sections', () => {
    expect(Object.keys(toAccounts?.policies ?? {})).toEqual(['profile']);
    expect(Object.keys(toAccounts?.fills ?? {})).toEqual(['identityProviders']);
    expect(Object.keys(whenAccounts?.reactions ?? {})).toEqual(['revokeOnDeactivation']);
  });

  it('carries the top-level policies and the empty sections', () => {
    expect(Object.keys(auth.policies)).toEqual(['credential', 'login']);
    expect(auth.schedules).toEqual({});
    expect(auth.lifecycle).toEqual({});
  });
});

describe('part references', () => {
  it('refuses a part mounted under two references', () => {
    const mount = () =>
      defineModule(authBase, {
        actions: { signOut: auth.actions.logout },
        entityActions: { credential: { revoke } },
      });
    try {
      mount();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeelwerkError);
      expect((error as KeelwerkError).details).toMatchObject({ code: 'partMountedTwice' });
    }
  });
});
