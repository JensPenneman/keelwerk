import type { Carrier, Invocation, InvocationSession, Invoker, Outcome } from '@keelwerk/core';
import { fakeSession } from './fake-session.ts';

export interface FakeInvokerOptions {
  /** Decides what `open` answers for a carrier; default: an anonymous session. */
  open?(carrier: Carrier): Outcome<InvocationSession>;
  /** The action handlers by reference; an unknown action is a thrown error. */
  actions?: Readonly<Record<string, (invocation: Invocation<unknown>) => Outcome<unknown>>>;
}

export interface FakeInvoker extends Invoker {
  readonly opened: Carrier[];
  readonly invoked: Invocation<unknown>[];
}

/** An invoker that records what the host hands it and answers from a table. */
export function createFakeInvoker(options: FakeInvokerOptions = {}): FakeInvoker {
  const opened: Carrier[] = [];
  const invoked: Invocation<unknown>[] = [];
  return {
    opened,
    invoked,
    async open(carrier) {
      opened.push(carrier);
      return options.open?.(carrier) ?? { ok: true, value: fakeSession() };
    },
    async invoke<I, O>(invocation: Invocation<I>) {
      invoked.push(invocation as Invocation<unknown>);
      const handler = options.actions?.[invocation.action];
      if (handler === undefined) {
        throw new Error(`no fake action ${invocation.action}`);
      }
      return handler(invocation as Invocation<unknown>) as Outcome<O>;
    },
    subscribe() {
      throw new Error('subscribe is not part of M1');
    },
  };
}
