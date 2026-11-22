import { describe, expect, onTestFinished, test } from 'vitest';
import { asBearer, codeOf, enrol, signIn, whoami } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';
import { holdJobs } from './support/hold-jobs.ts';

// The idle extension of a session is a timer that the session resolver sets at the edge, before
// every request of the session. The queued cap of the timers queue counts it and never refuses it
// (9.5.5): when the tenant's queue is at its cap, the requests of its sessions go on, and nothing
// but time or an operator would end a refusal there. One session has at most one such timer
// waiting (the key `extend:<session id>` replaces itself), so the sessions of a tenant add at most
// one timer each. A timer that a decision sets (a password reset request) still meets the cap.
// What decides each case: the answers of the calls and the number of jobs waiting in the timers
// queue, as the store counts them; the workers take nothing (`holdJobs`), the clock is moved by hand.

describe.each(['memory', 'pglite'] as const)(
  'the idle extension at the queued cap on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(): Promise<BootedAuth> {
      const auth = await bootAuth(kind);
      onTestFinished(() => auth.runtime.stop());
      return auth;
    }

    const timers = (auth: BootedAuth) => auth.inUnit((unit) => unit.jobs.queued('timers', 100));

    /** `core.quota.set` of the timers queue's cap for acme, as the operator. */
    async function capTimers(auth: BootedAuth, cap: number) {
      const { runtime } = auth;
      const acme = runtime.tenants.acme;
      if (acme === undefined) throw new Error('no tenant acme');
      const set = await runtime.invoker.invoke({
        action: 'core.quota.set',
        input: {
          dimension: 'queue:timers.queued',
          backendId: runtime.backendId,
          tenantId: acme.id,
          limit: String(cap),
          reason: 'the cap case',
        },
        carrier: { transport: 'test', local: { inProcess: true } },
        requestId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
      if (!set.ok) throw set.error;
    }

    test('with the timers queue at its cap a session opens its extension, its requests go on, and a decision timer is still refused', {
      timeout,
    }, async () => {
      const auth = await boot();
      holdJobs(auth.runtime.adapter);
      await enrol(auth);
      const first = await signIn(auth);
      const second = await signIn(auth);
      await capTimers(auth, 1);
      // A password reset request sets a timer under a key of its own: it fills the queue to its cap,
      // and the next one is refused at the true count.
      const reset = (identifier: string) =>
        auth.request('auth.requestPasswordReset', { identifier });
      expect((await reset('ada@example.org')).ok).toBe(true);
      expect(await timers(auth)).toBe(1);
      expect(codeOf(await reset('grace@example.org'))).toBe('core.queue_full');
      expect(await timers(auth)).toBe(1);
      // The first session is used after the extension interval: its resolver sets the extension timer
      // and the count stands above the cap.
      auth.clock.advance({ minutes: 6 });
      expect((await whoami(auth, asBearer(first.sessionToken))).ok).toBe(true);
      expect(await timers(auth)).toBe(2);
      // The same session again replaces its timer: one waiting timer for each session.
      auth.clock.advance({ minutes: 6 });
      expect((await whoami(auth, asBearer(first.sessionToken))).ok).toBe(true);
      expect(await timers(auth)).toBe(2);
      // A second session adds one timer of its own, and the first session's logout, which also sets its timer again, goes through.
      expect((await whoami(auth, asBearer(second.sessionToken))).ok).toBe(true);
      expect(await timers(auth)).toBe(3);
      auth.clock.advance({ minutes: 6 });
      const loggedOut = await auth.request(
        'auth.logout',
        {},
        { headers: asBearer(first.sessionToken) },
      );
      expect(loggedOut.ok).toBe(true);
      // The decision's timer is still refused, at the count that stands.
      expect(codeOf(await reset('grace@example.org'))).toBe('core.queue_full');
      expect(await timers(auth)).toBe(3);
    });
  },
);
