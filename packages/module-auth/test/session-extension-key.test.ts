import { describe, expect, onTestFinished, test } from 'vitest';
import { asBearer, enrol, signIn, whoami } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';

describe.each(['memory', 'pglite'] as const)('auth idle extension on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedAuth> {
    const auth = await bootAuth(kind);
    onTestFinished(() => auth.runtime.stop());
    return auth;
  }

  /** Cancels the pending commands jobs of a stored key text, as the job store matches it. */
  const cancelStored = (auth: BootedAuth, key: string) =>
    auth.inUnit((unit) => unit.jobs.cancel('commands', key));

  test('the idle extension is stored under the module of the session resolver', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const { sessionToken, sessionId } = await signIn(auth);
    auth.clock.advance({ minutes: 6 });
    await whoami(auth, asBearer(sessionToken));
    expect(await cancelStored(auth, `auth.extend:${sessionId}`)).toBe(0);
    expect(await cancelStored(auth, `auth:auth.extend:${sessionId}`)).toBe(1);
  });
});
