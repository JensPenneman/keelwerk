import type { Clock, InvocationSession, KeelwerkError, Outcome } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { pinnedLiveTimers } from '@keelwerk/testing';
import { expect, test } from 'vitest';
import { keepSocketSession } from '../src/keep-socket-session.ts';
import type { LiveSocketState } from '../src/live-socket-state.ts';
import { userSession } from './support/user-session.ts';

const zero = Temporal.Instant.from('2026-11-11T12:00:00Z');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const refusal = 'refused';

type Event =
  | { readonly kind: 'step'; readonly ms: number; readonly fire: boolean }
  | { readonly kind: 'invoke' | 'send' | 'close' | 'stop' }
  /** The clock moves to `before` ms ahead of the expiry of the session the socket holds (never back). */
  | { readonly kind: 'near'; readonly before: number; readonly fire: boolean }
  | {
      readonly kind: 'answer';
      readonly as: 'keep' | 'replace' | 'refuse';
      /** How far from the moment of the answer the session it brings expires. */
      readonly by: number;
    };

/** A small seeded generator (mulberry32): the same seed gives the same orders on every machine. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function orderOf(next: () => number): { first: number | undefined; events: Event[] } {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const events: Event[] = [];
  for (let at = 0, length = 5 + Math.floor(next() * 12); at < length; at += 1) {
    const kind = pick([
      'step',
      'step',
      'near',
      'near',
      'invoke',
      'invoke',
      'answer',
      'answer',
      'answer',
      'send',
      'send',
      'close',
      'stop',
    ] as const);
    if (kind === 'step')
      events.push({ kind, ms: pick([0, 1, 500, 999, 1000, 1001, 4000, 9000]), fire: next() < 0.7 });
    else if (kind === 'near')
      events.push({ kind, before: pick([1_500, 1_000, 500, 1, 0]), fire: next() < 0.7 });
    else if (kind === 'answer')
      events.push({
        kind,
        as: pick(['keep', 'replace', 'refuse'] as const),
        by: pick([0, 500, 1_500, 20_000]),
      });
    else events.push({ kind });
  }
  return { first: pick([undefined, 1_500, 3_000, 10_000, 60_000]), events };
}

/** Runs one order against the keeper and answers the first rule it breaks, or undefined. */
async function broken(first: number | undefined, events: readonly Event[], revalidateMs: number) {
  let now = zero;
  const clock: Clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  const asked: {
    readonly session: InvocationSession;
    readonly answer: (o: Outcome<InvocationSession>) => void;
  }[] = [];
  const make = (ms: number | undefined): InvocationSession => {
    const session: InvocationSession = userSession('ada', {
      ...(ms !== undefined && { expiresAt: zero.add({ milliseconds: ms }) }),
      revalidate: () => {
        if (endings.length > 0) askedAfterEnd += 1;
        return new Promise((answer) => asked.push({ session, answer }));
      },
    });
    return session;
  };
  const elapsed = () => now.since(zero).total('milliseconds');
  const endings: { readonly error: KeelwerkError; readonly lapsed: boolean }[] = [];
  let closed = false;
  let cleanup = false;
  let askedAfterEnd = 0;
  const state = {
    session: make(first),
    clock,
    timers,
    everything: new AbortController(),
    upgrade: { host: { liveSocket: { revalidateMs } } },
  } as unknown as LiveSocketState;
  const refuse = async (error: KeelwerkError): Promise<void> => {
    const { expiresAt } = state.session;
    endings.push({
      error,
      lapsed: expiresAt !== undefined && Temporal.Instant.compare(expiresAt, now) <= 0,
    });
    closed = true;
    // The host aborts what hangs on the socket when the socket's own cleanup runs, a little after the
    // ending, not at once: the keeper may be asked in between.
    cleanup = true;
  };
  const keeper = keepSocketSession(state, refuse);
  const leave = new Set(['close', 'stop']);
  let left = false;
  let fired = false;
  let late = false;
  for (const event of events) {
    // The keeper has had its turn only after a step that fired the timers, until the next event.
    fired = false;
    late = false;
    if (cleanup) {
      cleanup = false;
      state.everything.abort();
    }
    if (event.kind === 'step' || event.kind === 'near') {
      if (event.kind === 'step') now = now.add({ milliseconds: event.ms });
      else {
        const held = state.session.expiresAt?.subtract({ milliseconds: event.before });
        if (held !== undefined && Temporal.Instant.compare(held, now) > 0) now = held;
      }
      // Timers fire as real ones do: a wait that is already due when it is made fires at once.
      if (event.fire) {
        while ((await timers.fire()) > 0) await tick();
        fired = true;
      }
    } else if (event.kind === 'invoke' && !closed) void keeper.check();
    else if (event.kind === 'send' && !closed) {
      // A data frame goes out unless the keeper refuses it, as the connection's send does.
      if (!keeper.late()) {
        const { expiresAt } = state.session;
        if (expiresAt !== undefined && Temporal.Instant.compare(expiresAt, now) <= 0)
          return 'c: a data frame at or after the expiry';
      }
    } else if (leave.has(event.kind) && !closed) {
      closed = true;
      left = true;
      state.everything.abort();
    } else if (event.kind === 'answer') {
      const next = asked.shift();
      if (next !== undefined) {
        const base = elapsed();
        const held = state.session.expiresAt;
        // An answer that comes at or after the expiry of the session the socket holds ends the socket.
        late =
          !closed &&
          held !== undefined &&
          Temporal.Instant.compare(held, now) <= 0 &&
          event.as !== 'refuse';
        if (event.as === 'keep') next.answer({ ok: true, value: next.session });
        else if (event.as === 'replace') next.answer({ ok: true, value: make(base + event.by) });
        else
          next.answer({
            ok: false,
            error: coreError('core.unauthenticated', { message: refusal }),
          });
      }
    }
    await tick();
    await tick();
    const { expiresAt } = state.session;
    if (
      !closed &&
      fired &&
      expiresAt !== undefined &&
      Temporal.Instant.compare(expiresAt, now) <= 0
    ) {
      return 'a: open at or after the expiry of the session it holds';
    }
    if (late && !closed) return 'e: a late answer continued the socket';
    if (endings.length > 1) return 'd: ended more than once';
    if (askedAfterEnd > 0) return 'd: a check asked after the ending';
    for (const ending of endings) {
      if (left) return 'd: ended after the client left or the host stopped';
      if (ending.error.message !== refusal && !ending.lapsed)
        return 'b: ended while the session it holds is valid';
    }
    if (closed && !cleanup && timers.pending() > 0)
      return 'd: a wait of the keeper runs on after the end';
  }
  return undefined;
}

test('no order of the keeper’s events breaks its rules', async () => {
  const next = random(20_261_126);
  const found: string[] = [];
  for (let run = 0; run < 1500; run += 1) {
    const { first, events } = orderOf(next);
    const revalidateMs = next() < 0.5 ? 3_600_000 : 2_000;
    const rule = await broken(first, events, revalidateMs);
    if (rule !== undefined)
      found.push(`${rule} :: ${JSON.stringify({ first, revalidateMs, events })}`);
  }
  expect(found.slice(0, 3)).toEqual([]);
});
