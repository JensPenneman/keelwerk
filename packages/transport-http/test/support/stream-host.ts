import type { Carrier, Invocation, InvocationSession, LiveFrame, StateToken } from '@keelwerk/core';
import { pinnedLiveTimers } from '@keelwerk/testing';
import type { HttpHostOptions } from '../../src/index.ts';
import { createFakeHost, type FakeHost } from './create-fake-host.ts';
import { createFakeInvoker } from './fake-invoker.ts';
import { fakeSession } from './fake-session.ts';
import { fakeAction, fakeSurface, stringNode } from './fake-surface.ts';
import { realSseCarrier } from './real-sse-carrier.ts';

const start = Temporal.Instant.from('2026-11-11T12:00:00Z');

/** What a fake subscription is asked for. */
export type Subscribed = (
  invocation: Invocation<unknown>,
  resume: { readonly after: StateToken } | undefined,
) => AsyncIterable<LiveFrame<unknown>>;

/** A host over the real server-sent events carrier, a fake invoker and pinned timers on a clock the test moves. */
export interface StreamHost extends FakeHost {
  readonly timers: ReturnType<typeof pinnedLiveTimers>;
  /** Moves the clock to `ms` after the start, fires what is due and answers how many waits fired. */
  at(ms: number): Promise<number>;
  /** The invocations the invoker was asked to subscribe, in order. */
  readonly subscribed: Invocation<unknown>[];
  /** The carriers the invoker was asked to open sessions for. */
  readonly opened: Carrier[];
  /** Opens `GET /_keelwerk/v1/subscribe` for the one subscription. */
  open(query?: string, headers?: Record<string, string>): Promise<Response>;
}

export interface StreamHostOptions {
  readonly host?: HttpHostOptions;
  readonly session?: InvocationSession;
}

/** A host whose one subscription, `loans.loanEvents`, is what `subscribed` says. */
export function streamHost(subscribe: Subscribed, options: StreamHostOptions = {}): StreamHost {
  let now = start;
  const clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  const subscribed: Invocation<unknown>[] = [];
  const opened: Carrier[] = [];
  const base = createFakeInvoker({
    open: (carrier) => {
      opened.push(carrier);
      return { ok: true, value: options.session ?? fakeSession() };
    },
  });
  const invoker = {
    ...base,
    subscribe: (invocation: Invocation<unknown>, resume: Parameters<Subscribed>[1]) => {
      subscribed.push(invocation);
      return subscribe(invocation, resume);
    },
  } as unknown as typeof base;
  const made = createFakeHost(options.host ?? {}, {
    invoker,
    surface: fakeSurface([
      fakeAction('loans.loanEvents', { kind: 'subscription', output: stringNode }),
    ]),
    deps: { liveCarrier: () => realSseCarrier(), clock, timers },
  });
  return {
    ...made,
    timers,
    subscribed,
    opened,
    at: (ms) => {
      now = start.add({ milliseconds: ms });
      return timers.fire();
    },
    open: (query = '', headers = {}) =>
      made.host.fetch(
        new Request(`https://x.example/_keelwerk/v1/subscribe?action=loans.loanEvents${query}`, {
          headers,
        }),
      ),
  };
}
