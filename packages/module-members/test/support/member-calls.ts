import type { Id, InvocationSession, Outcome } from '@keelwerk/core';
import { type TestPrincipal, testCarrier, testPrincipal } from '@keelwerk/testing';
import type { BootedMembers } from './boot-members.ts';

/** The subjects of the test people: lower-case UUIDs, as subject columns hold. */
const founderSubject = '0192f3a0-0000-7000-8000-00000000f001';
const strangerSubject = '0192f3a0-0000-7000-8000-00000000f003';
const adminSubject = '0192f3a0-0000-7000-8000-00000000f004';
const viewerSubject = '0192f3a0-0000-7000-8000-00000000f005';
const secondAdminSubject = '0192f3a0-0000-7000-8000-00000000f006';
/** The address the owner's invitation of most tests goes to. */
const founderAddress = 'founder@example.com';

/** The person who brings a tenant up and owns it. */
export const founder: TestPrincipal = testPrincipal(founderSubject);
/** A person who accepts invitations. */
export const inviteeSubject = '0192f3a0-0000-7000-8000-00000000f002';
export const invitee: TestPrincipal = testPrincipal(inviteeSubject);
/** A person with no membership. */
export const stranger: TestPrincipal = testPrincipal(strangerSubject);
/** A person who holds the admin role in tests that need one. */
export const admin: TestPrincipal = testPrincipal(adminSubject);
/** A second admin, for tests where one admin acts on what another did. */
export const secondAdmin: TestPrincipal = testPrincipal(secondAdminSubject);
/** A person who holds the viewer role in tests that need one. */
export const viewer: TestPrincipal = testPrincipal(viewerSubject);

/** What `invite` and `createOwner` answer. */
export interface Invited {
  readonly id: Id<'members.invitation'>;
  readonly token?: string;
  readonly expiresAt: Temporal.Instant;
}

/** Brings a tenant up: an operator invites the owner, who accepts. */
export async function bringUpOwner(
  app: BootedMembers,
  tenant: 'acme' | 'globex' = 'acme',
): Promise<void> {
  const invited = await app.operator(tenant).attempt('members.invitation.createOwner', {
    email: founderAddress,
  });
  if (!invited.ok) throw invited.error;
  const { token } = invited.value as Invited;
  if (token === undefined) throw new Error('createOwner answered no token');
  const accepted = await app.as(founder, tenant).attempt('members.invitation.accept', { token });
  if (!accepted.ok) throw accepted.error;
}

/** Invites an address as a person (the founder unless named) and answers what is shown once. */
export async function inviteAs(
  app: BootedMembers,
  principal: TestPrincipal,
  input: { readonly email: string; readonly role: 'admin' | 'member' | 'viewer' },
): Promise<Invited> {
  const answer = await app.as(principal).attempt('members.invitation.invite', input);
  if (!answer.ok) throw answer.error;
  return answer.value as Invited;
}

/** Accepts an invitation as a person; the outcome as the tests compare it. */
export function acceptAs(app: BootedMembers, principal: TestPrincipal, token: string) {
  return app.as(principal).attempt('members.invitation.accept', { token });
}

/** The refusal of an outcome as the tests compare it, or undefined when it succeeded. */
export function refusalOfAttempt(outcome: {
  readonly ok: boolean;
  readonly error?: { readonly kind: string; readonly code: string; readonly message: string };
}): { readonly kind: string; readonly code: string; readonly message: string } | undefined {
  if (outcome.ok || outcome.error === undefined) return undefined;
  const { kind, code, message } = outcome.error;
  return { kind, code, message };
}

/** Makes a person a member of acme: the founder invites the address and the person accepts. */
export async function joinAs(
  app: BootedMembers,
  person: TestPrincipal,
  role: 'admin' | 'member' | 'viewer',
  email: string,
): Promise<string> {
  const invited = await inviteAs(app, founder, { email, role });
  const accepted = await acceptAs(app, person, invited.token ?? '');
  if (!accepted.ok) throw accepted.error;
  return (accepted.value as { membershipId: string }).membershipId;
}

/** A session opened now: it keeps what it was opened with, whatever happens to the person's membership afterwards. */
export async function sessionOpenedNow(
  app: BootedMembers,
  principal: TestPrincipal,
): Promise<InvocationSession> {
  const opened = await app.runtime.invoker.open(testCarrier(app.runtime.tenants.acme, principal));
  if (!opened.ok) throw opened.error;
  return opened.value;
}

/** Calls an action on a session opened earlier, as a long-lived connection does. */
export function callOnSession(
  app: BootedMembers,
  session: InvocationSession,
  principal: TestPrincipal,
  action: string,
  input: unknown,
): Promise<Outcome<unknown>> {
  return app.runtime.invoker.invoke({
    action,
    input,
    carrier: testCarrier(app.runtime.tenants.acme, principal),
    session,
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

/** The records of the control ledger that erase a subject, oldest first. */
export async function erasuresOf(app: BootedMembers): Promise<readonly Record<string, unknown>[]> {
  return (await app.ledger()).map((entry) => entry.record).filter((rec) => rec.type === 'erasure');
}
