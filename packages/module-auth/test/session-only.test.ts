import type { Id } from '@keelwerk/core';
import { testPrincipal } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { sessionOnlyReason } from '../src/lib/session-only-reason.ts';
import { sessionResolverId } from '../src/lib/session-resolver-id.ts';
import { ada, asBearer, codeOf, signIn, subjectOf } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';

const fresh = 'a brand new password 42';

describe.each(['memory', 'pglite'] as const)('session-only commands on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<{ both: BootedBoth; credentialId: string; profileId: string }> {
    const both = await bootBoth(kind);
    onTestFinished(() => both.runtime.stop());
    const done = await both.request('auth.signUp', ada);
    if (!done.ok) throw done.error;
    const profileId = String((await both.rows('accounts.profile'))[0]?.id);
    return { both, credentialId: (done.value as { credentialId: string }).credentialId, profileId };
  }

  test('a principal of another resolver is refused every command that changes how its owner signs in, with one reason', {
    timeout,
  }, async () => {
    const { both, credentialId, profileId } = await boot();
    const session = await signIn(both);
    const other = both.client(testPrincipal(await subjectOf(both, session)));
    const commands: readonly (readonly [string, unknown])[] = [
      ['auth.credential.revoke', { id: credentialId }],
      ['auth.session.revoke', { id: session.sessionId }],
      ['auth.logout', {}],
      ['auth.reauthenticate', { password: ada.password }],
      ['auth.extendSession', { sessionId: session.sessionId }],
      [
        'accounts.profile.changePassword',
        { id: profileId, currentPassword: ada.password, newPassword: fresh },
      ],
    ];
    for (const [action, input] of commands) {
      const outcome = await other.attempt(action as never, input as never);
      expect(outcome.ok, action).toBe(false);
      expect(outcome.ok ? undefined : outcome.error.kind, action).toBe('forbidden');
      expect(outcome.ok ? '' : outcome.error.message, action).toContain(sessionOnlyReason);
    }
    // Nothing changed: the session still stands and the credential is not revoked.
    const credential = (await both.rows('auth.credential'))[0];
    expect(credential?.revokedAt ?? null).toBeNull();
    expect(
      (await both.request('auth.whoami', {}, { headers: asBearer(session.sessionToken) })).ok,
    ).toBe(true);
  });

  test("ada's session still revokes a session and a credential, changes the password, reauthenticates and logs out", {
    timeout,
  }, async () => {
    const { both, credentialId, profileId } = await boot();
    const mine = await signIn(both);
    const spare = await signIn(both);
    const headers = asBearer(mine.sessionToken);
    expect(
      (await both.request('auth.reauthenticate', { password: ada.password }, { headers })).ok,
    ).toBe(true);
    expect(
      (await both.request('auth.session.revoke', { id: spare.sessionId }, { headers })).ok,
    ).toBe(true);
    const changed = await both.request(
      'accounts.profile.changePassword',
      {
        id: profileId as Id<'accounts.profile'>,
        currentPassword: ada.password,
        newPassword: fresh,
      },
      { headers },
    );
    if (!changed.ok) throw changed.error;
    const rotated = asBearer((changed.value as { sessionToken: string }).sessionToken);
    expect((await both.request('auth.logout', {}, { headers: rotated })).ok).toBe(true);
    const again = await signIn(both, { ...ada, password: fresh });
    const revoked = await both.request(
      'auth.credential.revoke',
      { id: credentialId },
      { headers: asBearer(again.sessionToken) },
    );
    expect(revoked.ok).toBe(true);
    expect(codeOf(await both.request('auth.login', { ...ada, password: fresh }))).toBe(
      'auth.invalid_credentials',
    );
  });

  test('a principal of another resolver still reads its own credentials and sessions', {
    timeout,
  }, async () => {
    const { both, credentialId } = await boot();
    const session = await signIn(both);
    const other = both.client(testPrincipal(await subjectOf(both, session)));
    const credentials = await other.invoke('auth.credential.query', {});
    expect(credentials.items.map((item) => item.id)).toEqual([credentialId]);
    const sessions = await other.invoke('auth.session.query', {});
    expect(sessions.items.map((item) => item.id)).toEqual([session.sessionId]);
  });
});

/** The commands anyone may call: a key holder gains nothing over leaving out the header, and each says why. */
const publicByDesign: Readonly<Record<string, string>> = {
  'auth.login': 'public: it takes the identifier and the password and asks for no session',
  'auth.signUp': 'public: it creates a new person and changes no one existing',
  'auth.requestPasswordReset': 'public: it only mails a link to the address that owns the account',
  'auth.resetPassword': 'public: it is authorized by the one-time link, not by a session',
};

describe('every command of the module that admits a user', () => {
  test('is refused to a user of another resolver, or is named here with its reason', async () => {
    const both = await bootBoth('memory');
    onTestFinished(() => both.runtime.stop());
    const { actions, rules } = both.runtime.app.registry;
    const live = [...rules.values()].filter((rule) => !rule.disabled);
    const covers = (
      rule: (typeof live)[number],
      action: { entity?: string; module: string; name: string },
    ) => {
      const { subject } = rule;
      if (!('module' in subject)) return false;
      const same =
        subject.entity === undefined
          ? action.entity === undefined && subject.module === action.module
          : action.entity === `${subject.module}.${subject.entity}`;
      return same && (rule.actions.includes(action.name) || rule.actions.includes('*'));
    };
    const forUsers = (rule: (typeof live)[number]) =>
      rule.principal === undefined ||
      (Array.isArray(rule.principal) ? rule.principal : [rule.principal]).includes('user');
    const commands = [...actions.values()].filter(
      (action) =>
        action.kind === 'command' && (action.module === 'auth' || action.contributedBy === 'auth'),
    );
    expect(commands.length).toBeGreaterThan(8);
    const sessionOnly = (action: (typeof commands)[number]) =>
      live.filter(
        (rule) =>
          rule.effect === 'deny' &&
          rule.reason === sessionOnlyReason &&
          forUsers(rule) &&
          covers(rule, action),
      );
    // Runs the rule's own predicate: it denies a user of another resolver and not one of the session's.
    const denies = (rule: (typeof live)[number], resolver: string): boolean => {
      const condition = rule.where ?? rule.when;
      if (condition === undefined) return false;
      const context = { principal: { kind: 'user', ref: { resolver } } };
      return condition.call(rule, context, {}) === true;
    };
    const admitting = commands.filter(
      (action) =>
        action.auth === 'public' ||
        live.some((rule) => rule.effect === 'allow' && forUsers(rule) && covers(rule, action)),
    );
    // The walk can never be empty: these six admit a user and each has a rule.
    const six = [
      'auth.credential.revoke',
      'auth.session.revoke',
      'auth.logout',
      'auth.reauthenticate',
      'auth.extendSession',
      'accounts.profile.changePassword',
    ];
    expect(admitting.map((action) => action.ref)).toEqual(expect.arrayContaining(six));
    const unclassified: string[] = [];
    for (const action of admitting) {
      if (action.ref in publicByDesign) continue;
      const rules = sessionOnly(action);
      const works = rules.some(
        (rule) => denies(rule, 'other.key') && !denies(rule, sessionResolverId),
      );
      if (!works) unclassified.push(action.ref);
    }
    expect(unclassified).toEqual([]);
    // The named list names only commands that are still public.
    for (const ref of Object.keys(publicByDesign)) {
      expect(commands.find((action) => action.ref === ref)?.auth, ref).toBe('public');
    }
  });
});
