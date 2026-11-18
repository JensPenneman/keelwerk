import { setMaxListeners } from 'node:events';
import type { ServiceGate } from './service-gate.ts';

/** An open gate. */
export function createServiceGate(): ServiceGate {
  let closed = false;
  let resolve: (reason: string) => void = () => undefined;
  const controller = new AbortController();
  // Any number of subscriptions listen at once; none of them is a leak.
  setMaxListeners(0, controller.signal);
  let isRecorded = false;
  let reason: string | undefined;
  let leave: (reason: string) => void = () => undefined;
  const whenClosed = new Promise<string>((done) => {
    resolve = done;
  });
  const outOfService = new Promise<string>((done) => {
    leave = done;
  });
  const settle = (): void => {
    if (closed && isRecorded && reason !== undefined) leave(reason);
  };
  return {
    get closed() {
      return closed;
    },
    close: (why, options) => {
      if (closed) return;
      closed = true;
      reason = why;
      isRecorded = options?.evidence !== 'pending';
      resolve(why);
      controller.abort(why);
      settle();
    },
    recorded: () => {
      isRecorded = true;
      settle();
    },
    whenClosed,
    outOfService,
    signal: controller.signal,
  };
}
