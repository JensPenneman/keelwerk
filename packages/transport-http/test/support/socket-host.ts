import type { Carrier, Invocation, InvocationSession } from '@keelwerk/core';
import { pinnedLiveTimers } from '@keelwerk/testing';
import type { HttpHostDeps, HttpHostOptions } from '../../src/index.ts';
import { connectLiveSocket } from './connect-live-socket.ts';
import { createFakeHost, type FakeHost } from './create-fake-host.ts';
import { createFakeInvoker, type FakeInvoker, type FakeInvokerOptions } from './fake-invoker.ts';
import { fakeSession } from './fake-session.ts';
import { fakeAction, fakeSurface, stringNode } from './fake-surface.ts';
import { librarySurface } from './library-surface.ts';
import type { LiveSocketClient } from './live-socket-client.ts';
import { realWebsocketCarrier } from './real-websocket-carrier.ts';
import type { Subscribed } from './stream-host.ts';

const start = Temporal.Instant.from('2026-11-11T12:00:00Z');

/** A listening host over the real WebSocket carrier, a fake invoker and pinned timers on a clock the test moves. */
export interface SocketHost extends FakeHost {
  readonly timers: ReturnType<typeof pinnedLiveTimers>;
  readonly port: number;
  /** Moves the clock to `ms` after the start, fires what is due and answers how many waits fired. */
  at(ms: number): Promise<number>;
  /** The invocations the invoker was asked to subscribe, in order. */
  readonly subscribed: Invocation<unknown>[];
  /** The carriers the invoker was asked to open sessions for. */
  readonly opened: Carrier[];
  /** Connects a client; the refusal when the upgrade is refused. */
  connect(
    headers?: Record<string, string>,
    options?: { readonly autoPong?: boolean; readonly query?: string },
  ): Promise<LiveSocketClient | { readonly status: number; readonly body: unknown }>;
}

export interface SocketHostOptions {
  readonly host?: HttpHostOptions;
  readonly session?: InvocationSession;
  /** Decides what `open` answers for a carrier; default: the session of the options. */
  readonly open?: FakeInvoker['open'];
  readonly actions?: FakeInvokerOptions['actions'];
  readonly deps?: Partial<HttpHostDeps>;
}

/** A listening host whose one subscription, `loans.loanEvents`, is what `subscribe` says. */
export async function socketHost(
  subscribe: Subscribed,
  options: SocketHostOptions = {},
): Promise<SocketHost> {
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
    ...(options.actions === undefined ? {} : { actions: options.actions }),
  });
  const invoker = {
    ...base,
    ...(options.open === undefined ? {} : { open: options.open }),
    subscribe: (invocation: Invocation<unknown>, resume: Parameters<Subscribed>[1]) => {
      subscribed.push(invocation);
      return subscribe(invocation, resume);
    },
  } as unknown as typeof base;
  const made = createFakeHost(
    { listen: { port: 0 }, ...options.host },
    {
      invoker,
      surface: fakeSurface([
        ...librarySurface.actions,
        fakeAction('loans.loanEvents', { kind: 'subscription', output: stringNode }),
      ]),
      deps: { liveCarrier: () => realWebsocketCarrier(), clock, timers, ...options.deps },
    },
  );
  const { port } = await made.host.listen();
  if (port === undefined) throw new Error('the host has no port');
  return {
    ...made,
    timers,
    port,
    subscribed,
    opened,
    at: (ms) => {
      now = start.add({ milliseconds: ms });
      return timers.fire();
    },
    connect: (headers = {}, connectOptions = {}) =>
      connectLiveSocket(port, 'x.example', headers, undefined, connectOptions),
  };
}
