import { expectReproduces, testOperator } from '@keelwerk/testing';
import { afterAll, describe, expect, test } from 'vitest';
import { type LocalPortal, startLocalPortal } from './support/local-portal.ts';
import { credentialsOf, freshPerson, type Person } from './support/people.ts';
import { sessionPrincipal } from './support/session-principal.ts';

const operator = testOperator();
const fresh = 'a brand new password 42';

const booted = {
  memory: await startLocalPortal('memory'),
  pglite: await startLocalPortal('pglite'),
};
afterAll(async () => {
  for (const portal of Object.values(booted)) await portal.runtime.stop();
});

/** Runs a command with a chosen id, so the test can find its record again. */
async function run(
  portal: LocalPortal,
  action: string,
  input: unknown,
  headers: Record<string, string> = {},
): Promise<{ readonly commandId: string; readonly value: unknown }> {
  const commandId = crypto.randomUUID();
  const done = await portal.request(action, input, { headers, commandId });
  if (!done.ok) throw done.error;
  return { commandId, value: done.value };
}

const signUpInput = (person: Person) => ({ ...credentialsOf(person), displayName: 'Ada' });

async function signedUp(portal: LocalPortal) {
  const ada = freshPerson();
  const signUp = await run(portal, 'auth.signUp', signUpInput(ada));
  return { ada, signUp };
}

describe.each(['memory', 'pglite'] as const)(
  'a handler of the scenario re-decides from its record on %s',
  (kind) => {
    const timeout = 60_000;

    test('auth.signUp, with the registration and the profile it invokes', { timeout }, async () => {
      const { ada, signUp } = await signedUp(booted[kind]);
      const result = await expectReproduces(booted[kind].runtime, {
        commandId: signUp.commandId,
        input: signUpInput(ada),
      });
      expect(result.reproduced).toBe(true);
    });

    test('auth.login', { timeout }, async () => {
      const portal = booted[kind];
      const { ada } = await signedUp(portal);
      const login = await run(portal, 'auth.login', credentialsOf(ada));
      const result = await expectReproduces(portal.runtime, {
        commandId: login.commandId,
        input: credentialsOf(ada),
      });
      expect(result.reproduced).toBe(true);
    });

    test('auth.logout, as the session that made it', { timeout }, async () => {
      const portal = booted[kind];
      const { ada } = await signedUp(portal);
      const login = await run(portal, 'auth.login', credentialsOf(ada));
      const session = login.value as { sessionToken: string; sessionId: string };
      const bearer = { authorization: `Bearer ${session.sessionToken}` };
      const who = await portal.request('auth.whoami', {}, { headers: bearer });
      const subject = who.ok ? (who.value as { subject: string }).subject : '';
      const logout = await run(portal, 'auth.logout', {}, bearer);
      const { runtime } = portal;
      const principal = sessionPrincipal(
        { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants.acme.id },
        subject,
        session.sessionId,
      );
      const result = await expectReproduces(portal.runtime, {
        commandId: logout.commandId,
        input: {},
        principal,
      });
      expect(result.reproduced).toBe(true);
    });

    test('auth.issueResetLink and auth.resetPassword', { timeout }, async () => {
      const portal = booted[kind];
      const { ada } = await signedUp(portal);
      const link = await portal.client(operator).attempt('auth.issueResetLink', {
        identifier: ada.identifier,
      });
      if (!link.ok) throw link.error;
      const issued = { identifier: ada.identifier };
      expect(link.commandId).toBeDefined();
      const input = { token: link.value.token, newPassword: fresh };
      const reset = await run(portal, 'auth.resetPassword', input);
      expect(
        (await expectReproduces(portal.runtime, { commandId: reset.commandId, input })).reproduced,
      ).toBe(true);
      expect(
        (
          await expectReproduces(portal.runtime, {
            commandId: String(link.commandId),
            input: issued,
          })
        ).reproduced,
      ).toBe(true);
    });
  },
);
