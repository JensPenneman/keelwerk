import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, codeOf, enrol, grace, signIn, subjectOf } from './support/auth-calls.ts';
import { authErasingApp, type BootedAuth, bootAuth } from './support/boot-auth.ts';

/** Two people with a session each, in a tenant of an app that does or does not add `selfErase`. */
async function boot(adds: boolean): Promise<{
  auth: BootedAuth;
  mine: { subject: string; headers: Record<string, string> };
  theirs: { subject: string };
}> {
  const auth = await bootAuth(
    'memory',
    {},
    undefined,
    undefined,
    adds ? authErasingApp : undefined,
  );
  onTestFinished(() => auth.runtime.stop());
  await enrol(auth, ada);
  await enrol(auth, grace);
  const adaSession = await signIn(auth, ada);
  const graceSession = await signIn(auth, grace);
  return {
    auth,
    mine: {
      subject: await subjectOf(auth, adaSession),
      headers: asBearer(adaSession.sessionToken),
    },
    theirs: { subject: await subjectOf(auth, graceSession) },
  };
}

/** Sends the erasure with a command id of the test's own, so the receipt can be looked up. */
function erase(auth: BootedAuth, subjectId: string, headers: Record<string, string>) {
  const commandId = crypto.randomUUID();
  return {
    commandId,
    outcome: auth.request(
      'core.eraseSubject',
      { subjectId, reason: 'subjectRequest' },
      { headers, commandId },
    ),
  };
}

/** The status of the erasure command's receipt in the tenant, undefined when none was written. */
async function receiptOf(auth: BootedAuth, commandId: string): Promise<string | undefined> {
  return (await auth.inUnit((unit) => unit.receipts.get(commandId), { sealed: true }))?.status;
}

describe('self-service erasure is the platform to switch on (14.7.5, README)', () => {
  test('an app with auth and no policies.add refuses a user their own erasure', async () => {
    const { auth, mine } = await boot(false);
    const sent = erase(auth, mine.subject, mine.headers);
    expect(codeOf(await sent.outcome)).toBe('core.forbidden');
    expect(await receiptOf(auth, sent.commandId)).toBeUndefined();
  });

  test('with selfErase added, a user erases their own subject and nobody else', async () => {
    const { auth, mine, theirs } = await boot(true);
    const other = erase(auth, theirs.subject, mine.headers);
    expect(codeOf(await other.outcome)).toBe('core.forbidden');
    expect(await receiptOf(auth, other.commandId)).toBeUndefined();
    const own = erase(auth, mine.subject, mine.headers);
    expect((await own.outcome).ok).toBe(true);
    expect(await receiptOf(auth, own.commandId)).toBe('accepted');
  });

  test('a user whose subject is 32 hex digits erases it written as a hyphenated UUID, an upper-case spelling is refused, and nobody else is erased', async () => {
    const { auth, mine, theirs } = await boot(true);
    expect(mine.subject).toMatch(/^[0-9a-f]{32}$/);
    const hyphenated = [8, 4, 4, 4, 12]
      .map((length, at, lengths) => {
        const from = lengths.slice(0, at).reduce((sum, part) => sum + part, 0);
        return mine.subject.slice(from, from + length);
      })
      .join('-');
    const own = erase(auth, hyphenated, mine.headers);
    expect((await own.outcome).ok).toBe(true);
    expect(await receiptOf(auth, own.commandId)).toBe('accepted');
    // An upper-case spelling is no accepted spelling of the erasure input.
    const upper = erase(auth, mine.subject.toUpperCase(), mine.headers);
    expect(codeOf(await upper.outcome)).toBe('core.validation');
    const other = erase(auth, theirs.subject, mine.headers);
    expect(codeOf(await other.outcome)).toBe('core.forbidden');
  });
});
