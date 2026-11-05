import { expect } from 'vitest';
import type { BootedAuth } from './boot-auth.ts';

type Outcome = Awaited<ReturnType<BootedAuth['request']>>;

/** A person the tests sign up. */
export interface Person {
  readonly identifier: string;
  readonly password: string;
}

export const ada: Person = {
  identifier: 'ada@example.org',
  password: 'correct horse battery staple',
};
export const grace: Person = { identifier: 'grace@example.org', password: 'hopper-cobol-1959' };

/** What `auth.login` answers. */
export interface Session {
  readonly sessionToken: string;
  readonly sessionId: string;
  readonly expiresAt: Temporal.Instant;
}

/** The error code of a refused outcome; undefined when it succeeded. */
export function codeOf(outcome: Outcome): string | undefined {
  return outcome.ok ? undefined : outcome.error.code;
}

export const asCookie = (token: string): Record<string, string> => ({
  cookie: `__Host-keelwerk_session=${token}`,
});
export const asBearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

/** Signs a person up and returns the credential's id. */
export async function enrol(
  auth: BootedAuth,
  person: Person = ada,
  tenant: 'acme' | 'globex' = 'acme',
): Promise<string> {
  const done = await auth.request('auth.signUp', person, { tenant });
  if (!done.ok) throw done.error;
  return (done.value as { credentialId: string }).credentialId;
}

/** Logs a person in and returns the session. */
export async function signIn(
  auth: BootedAuth,
  person: Person = ada,
  tenant: 'acme' | 'globex' = 'acme',
): Promise<Session> {
  const done = await auth.request('auth.login', person, { tenant });
  if (!done.ok) throw done.error;
  return done.value as Session;
}

/** What `auth.whoami` answers for a request that carries these headers. */
export async function whoami(auth: BootedAuth, headers: Record<string, string>) {
  return auth.request('auth.whoami', {}, { headers });
}

/**
 * A public action called with a presented token: a stale cookie runs it as anonymous (its own
 * answer), while a stale bearer token fails before the action (17.2.4).
 */
export function probe(auth: BootedAuth, headers: Record<string, string>) {
  return auth.request(
    'auth.login',
    { identifier: 'nobody@example.org', password: 'nothing' },
    { headers },
  );
}

/** The subject a session stands for. */
export async function subjectOf(auth: BootedAuth, session: Session): Promise<string> {
  const done = await whoami(auth, asBearer(session.sessionToken));
  expect(done.ok).toBe(true);
  return (done.ok ? (done.value as { subject: string }).subject : '') as string;
}
