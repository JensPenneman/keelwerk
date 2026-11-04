import { describe, expect, it } from 'vitest';
import { camel } from './camel.ts';
import { camelFromKebab } from './camel-from-kebab.ts';
import { kebab } from './kebab.ts';
import { pascal } from './pascal.ts';
import { plural } from './plural.ts';

describe('naming', () => {
  it('camel and pascal join the segments of a reference', () => {
    expect(camel('api-keys.key.revoke')).toBe('apiKeysKeyRevoke');
    expect(camel('accounts.profileSearch')).toBe('accountsProfileSearch');
    expect(pascal('accounts.profile')).toBe('AccountsProfile');
    expect(pascal('accounts.email_taken')).toBe('AccountsEmailTaken');
  });

  it('kebab splits lower camel case on word boundaries', () => {
    expect(kebab('resetPassword')).toBe('reset-password');
    expect(kebab('profile')).toBe('profile');
    expect(kebab('address2Line')).toBe('address2-line');
    expect(kebab('sessionEvents')).toBe('session-events');
  });

  it('camelFromKebab camel-cases a module id', () => {
    expect(camelFromKebab('api-keys')).toBe('apiKeys');
    expect(camelFromKebab('auth')).toBe('auth');
    expect(camelFromKebab('a-b-c')).toBe('aBC');
  });

  it('plural follows the frozen rules', () => {
    for (const [word, expected] of [
      ['mailbox', 'mailboxes'],
      ['bus', 'buses'],
      ['quiz', 'quizes'],
      ['match', 'matches'],
      ['dash', 'dashes'],
      ['policy', 'policies'],
      ['key', 'keys'],
      ['day', 'days'],
      ['profile', 'profiles'],
      ['apiKey', 'apiKeys'],
      ['identity', 'identities'],
      ['session', 'sessions'],
    ] as const) {
      expect(plural(word)).toBe(expected);
    }
  });
});
