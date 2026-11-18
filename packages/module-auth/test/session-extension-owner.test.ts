import { defineApp } from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { auth } from '../src/module.generated.ts';
import { asBearer, enrol, signIn, whoami } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';
import { holdJobs } from './support/hold-jobs.ts';
import { shadowModule } from './support/shadow-module.ts';

const withShadow = defineApp({ id: 'auth', modules: [auth, shadowModule] as const });

describe.each(['memory', 'pglite'] as const)(
  'the owner of an idle extension on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(): Promise<BootedAuth> {
      const booted = await bootAuth(kind, {}, undefined, undefined, withShadow as never);
      onTestFinished(() => booted.runtime.stop());
      return booted;
    }

    /** The jobs of a queue that wait to run. */
    const waiting = (booted: BootedAuth, queue: string) =>
      booted.inUnit((unit) => unit.jobs.queued(queue, 100));

    const idleExpiry = async (booted: BootedAuth, sessionId: string): Promise<string> => {
      const rows = await booted.inUnit(
        async (unit) => {
          const descriptor = booted.runtime.app.registry.entities.get('auth.session')?.descriptor;
          if (descriptor === undefined) throw new Error('no auth.session');
          return (await unit.rows.find(descriptor, { select: Object.keys(descriptor.fields) }))
            .rows;
        },
        { sealed: true },
      );
      return String(rows.find((row) => row.id === sessionId)?.idleExpiresAt);
    };

    /** The shadow enqueues its own job under the text auth uses, then the session is used after six minutes. */
    async function shadowHoldsTheKey(afterMinutes: number) {
      const booted = await boot();
      const held = holdJobs(booted.runtime.adapter);
      await enrol(booted);
      const { sessionToken, sessionId } = await signIn(booted);
      const before = await idleExpiry(booted, sessionId);
      const queued = await booted.request('shadow.hold', { sessionId, afterMinutes });
      expect(queued.ok).toBe(true);
      booted.clock.advance({ minutes: 6 });
      expect((await whoami(booted, asBearer(sessionToken))).ok).toBe(true);
      return { booted, sessionId, before, held };
    }

    test("another module's job under the same key text does not keep auth's extension out", {
      timeout,
    }, async () => {
      const { booted, sessionId, before, held } = await shadowHoldsTheKey(60);
      held.release();
      await booted.settle();
      expect(await idleExpiry(booted, sessionId)).not.toBe(before);
      expect(
        Temporal.Instant.compare(
          Temporal.Instant.from(await idleExpiry(booted, sessionId)),
          Temporal.Instant.from(before),
        ),
      ).toBeGreaterThan(0);
    });

    test("the other module's job is still pending under its own module's key once auth's extension ran", {
      timeout,
    }, async () => {
      const { booted, sessionId, before, held } = await shadowHoldsTheKey(60);
      held.release();
      await booted.settle();
      expect(await idleExpiry(booted, sessionId)).not.toBe(before);
      expect(await waiting(booted, 'timers')).toBe(0);
      expect(await waiting(booted, 'commands')).toBe(1);
    });

    test("the other module's job runs at its own time", { timeout }, async () => {
      const { booted, held } = await shadowHoldsTheKey(60);
      held.release();
      await booted.settle();
      const done = held.outcomes.length;
      booted.clock.advance({ hours: 2 });
      await booted.settle();
      expect(held.outcomes.length).toBe(done + 1);
      expect(held.outcomes.at(-1)).toEqual({ kind: 'succeeded' });
      expect(await waiting(booted, 'commands')).toBe(0);
    });
  },
);
