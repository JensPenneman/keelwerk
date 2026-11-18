import { defineApp } from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { sessionExtensionKey } from '../src/lib/session-extension-key.ts';
import { auth } from '../src/module.generated.ts';
import { asBearer, enrol, signIn, whoami } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';
import { holdJobs } from './support/hold-jobs.ts';
import { shadowModule } from './support/shadow-module.ts';

const withShadow = defineApp({ id: 'auth', modules: [auth, shadowModule] as const });

describe.each(['memory', 'pglite'] as const)('auth idle extension on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedAuth> {
    const booted = await bootAuth(kind, {}, undefined, undefined, withShadow as never);
    onTestFinished(() => booted.runtime.stop());
    return booted;
  }

  /** The timers that wait to run. */
  const pending = (booted: BootedAuth) => booted.inUnit((unit) => unit.jobs.queued('timers', 100));

  /** Cancels the pending timers of a key text as the job store matches it, whoever set them. */
  const cancelText = (booted: BootedAuth, key: string) =>
    booted.inUnit((unit) => unit.jobs.cancel('timers', key));

  test('requests of one session share one timer of the module, which no other text or module reaches', {
    timeout,
  }, async () => {
    const booted = await boot();
    const held = holdJobs(booted.runtime.adapter);
    await enrol(booted);
    const { sessionToken, sessionId } = await signIn(booted);
    const key = sessionExtensionKey(sessionId);
    expect(await pending(booted)).toBe(0);
    booted.clock.advance({ minutes: 6 });
    expect((await whoami(booted, asBearer(sessionToken))).ok).toBe(true);
    expect(await pending(booted)).toBe(1);
    // A later request that comes due while the timer waits replaces it: the same key.
    booted.clock.advance({ minutes: 6 });
    expect((await whoami(booted, asBearer(sessionToken))).ok).toBe(true);
    expect(await pending(booted)).toBe(1);
    // The key text is not what the timer is stored under, with or without the module's id.
    expect(await cancelText(booted, key)).toBe(0);
    expect(await cancelText(booted, `auth:${key}`)).toBe(0);
    expect(await pending(booted)).toBe(1);
    // Another module that sets and cancels a timer under the same text reaches only its own.
    expect((await booted.request('shadow.arm', { sessionId })).ok).toBe(true);
    expect(await pending(booted)).toBe(2);
    expect((await booted.request('shadow.cancel', { sessionId })).ok).toBe(true);
    expect(await pending(booted)).toBe(1);
    held.release();
    await booted.settle();
    expect(held.outcomes.every((outcome) => outcome.kind === 'succeeded')).toBe(true);
    expect(await pending(booted)).toBe(0);
  });
});
