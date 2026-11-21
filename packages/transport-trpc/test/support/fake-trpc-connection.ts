import type { Carrier, InvocationSession, SocketSession } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { trpcSession } from './trpc-kit.ts';

/** What a fake host session records of the handler. */
export interface FakeTrpcConnection {
  readonly connection: SocketSession;
  readonly opened: unknown[];
  readonly slots: { id: string; released: number; abort: AbortController }[];
  /** How many times the session check ran. */
  readonly checks: { count: number };
  /** The call slots taken and given back. */
  readonly invocations: { taken: number; released: number };
  /** Resolves once `open` has returned its answer. */
  readonly openSettled: Promise<void>;
  /** Replaces what `session()` answers from now on. */
  replace(session: InvocationSession): void;
}

/** A host session of a socket that records what the handler asked of it. */
export function fakeTrpcConnection(
  over: {
    readonly refuseSlot?: boolean;
    readonly refuseOpen?: boolean;
    /** False: the session check does not hold. */
    readonly holds?: boolean;
    readonly session?: InvocationSession;
    /** What `carrier()` answers; default: an HTTP carrier with no headers and no connection. */
    readonly carrier?: Carrier;
    /** The call slots the socket holds at most; default 32, the host's. */
    readonly maxPendingInvokes?: number;
    /** The largest message the host takes; default 1 MiB, the host's. */
    readonly maxMessageBytes?: number;
    /** `open` answers only once this settles: what the socket sends meanwhile waits for the host. */
    readonly openGate?: Promise<void>;
  } = {},
): FakeTrpcConnection {
  const opened: unknown[] = [];
  const slots: { id: string; released: number; abort: AbortController }[] = [];
  const checks = { count: 0 };
  const invocations = { taken: 0, released: 0 };
  let session = over.session ?? trpcSession();
  let settle: () => void = () => undefined;
  const openSettled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const connection: SocketSession = {
    session: () => session,
    carrier: () =>
      over.carrier ?? { transport: 'http', host: 'portal.example', path: '/trpc', headers: {} },
    maxMessageBytes: over.maxMessageBytes ?? 1_048_576,
    open: async (credentials) => {
      opened.push(credentials);
      settle();
      await over.openGate;
      if (over.refuseOpen === true) {
        return { ok: false, error: coreError('core.unauthenticated') };
      }
      return { ok: true, value: session };
    },
    subscription: (id) => {
      if (over.refuseSlot === true) throw coreError('core.quota_exceeded');
      const slot = { id, released: 0, abort: new AbortController() };
      slots.push(slot);
      return {
        signal: slot.abort.signal,
        release: () => {
          slot.released += 1;
        },
      };
    },
    invocation: () => {
      if (invocations.taken - invocations.released >= (over.maxPendingInvokes ?? 32)) {
        throw coreError('core.quota_exceeded');
      }
      invocations.taken += 1;
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          invocations.released += 1;
        },
      };
    },
    check: async () => {
      checks.count += 1;
      return over.holds !== false;
    },
    signal: new AbortController().signal,
  };
  return {
    connection,
    opened,
    slots,
    checks,
    invocations,
    openSettled,
    replace: (next) => {
      session = next;
    },
  };
}
