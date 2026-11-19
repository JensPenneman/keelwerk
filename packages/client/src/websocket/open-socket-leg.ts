import type { LiveServerMessage, StateToken, WireError } from '@keelwerk/core';
import { clientFailure } from '../client-failure.ts';
import { errorOfEnvelope } from '../error-of-envelope.ts';
import { isRecord } from '../is-record.ts';
import type { LiveLeg } from '../live-leg.ts';
import type { LiveLegEvent } from '../live-leg-event.ts';
import type { RemoteClientState } from '../remote-client-state.ts';

const protocol = 'keelwerk.live.v1';
const subscription = 's1';

function eventOf(message: LiveServerMessage): LiveLegEvent | undefined {
  switch (message.type) {
    case 'data':
      return {
        kind: 'frame',
        frame: {
          event: message.item,
          ...(message.state !== undefined && { state: message.state as StateToken }),
        },
      };
    case 'head':
      return { kind: 'frame', frame: { control: 'head', state: message.state as StateToken } };
    case 'reset':
      return {
        kind: 'frame',
        frame: {
          control: 'reset',
          reason: message.reason,
          ...(message.state !== undefined && { state: message.state as StateToken }),
        },
      };
    case 'gap':
      return {
        kind: 'frame',
        frame: { control: 'gap', ...(message.missed !== undefined && { missed: message.missed }) },
      };
    case 'error':
      return { kind: 'error', error: message.error };
    case 'end':
      return { kind: 'end', reason: message.reason };
    default:
      return undefined;
  }
}

function messageOf(data: unknown): LiveServerMessage | undefined {
  if (typeof data !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) && typeof parsed.type === 'string'
      ? (parsed as unknown as LiveServerMessage)
      : undefined;
  } catch {
    return undefined;
  }
}

function socketUrl(origin: string): string {
  return `${origin.replace(/^http/, 'ws')}/_keelwerk/v1/live`;
}

/**
 * One `keelwerk.live.v1` socket per leg (15.4.7): `hello` with the credential and the selectors,
 * then, once `welcome` arrived, `subscribe` as `s1`. The leg resolves at the server's first answer to
 * `s1` (its first frame), like the server-sent events leg resolves at its first response: an `error`
 * before it, to the `hello` or to `s1`, rejects with that error (so a refused reopen is told apart
 * from a failed stream by what the refusal is) and a close before it with `core.unavailable`. The
 * events are what the server says of `s1` (and an `error` without an id); a close ends them, and
 * `return()` unsubscribes and closes the socket.
 */
export function openSocketLeg(state: RemoteClientState): LiveLeg {
  return (request, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const open =
        state.webSocket ??
        ((url: string, protocols: readonly string[]) => new WebSocket(url, [...protocols]));
      const socket = open(socketUrl(state.origin), [protocol]);
      const queue: LiveLegEvent[] = [];
      let wake: (() => void) | undefined;
      let closed = false;
      let welcomed = false;
      let settled = false;
      let refusing = false;
      const notify = (): void => {
        wake?.();
        wake = undefined;
      };
      const send = (message: unknown): void => {
        if (socket.readyState === 1) socket.send(JSON.stringify(message));
      };
      const close = (): void => {
        if (socket.readyState === 0 || socket.readyState === 1) socket.close(1000);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        close();
        reject(error);
      };
      const refuse = (error: WireError): void => {
        refusing = true;
        void state.surfaces
          .get()
          .then(
            (loaded) => errorOfEnvelope({ ok: false, error }, 200, loaded),
            (failure: unknown) => failure,
          )
          .then(fail);
      };
      const onAbort = (): void => {
        if (!settled) fail(signal.reason);
        else {
          closed = true;
          close();
          notify();
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      const events: AsyncIterator<LiveLegEvent> = {
        async next() {
          for (;;) {
            const next = queue.shift();
            if (next !== undefined) return { done: false, value: next };
            if (closed) return { done: true, value: undefined };
            await new Promise<void>((wakeUp) => {
              wake = wakeUp;
            });
          }
        },
        async return() {
          if (!closed) send({ type: 'unsubscribe', id: subscription });
          closed = true;
          signal.removeEventListener('abort', onAbort);
          close();
          return { done: true, value: undefined };
        },
      };
      socket.addEventListener('open', () => {
        send({
          type: 'hello',
          ...(state.token !== undefined && { token: state.token }),
          ...(state.backend !== undefined && { backend: state.backend }),
          ...(state.tenant !== undefined && { tenant: state.tenant }),
          apiVersion: state.apiVersion,
        });
      });
      socket.addEventListener('message', (incoming) => {
        const message = messageOf(incoming.data);
        if (message === undefined) return;
        if (!welcomed) {
          if (message.type === 'welcome') {
            welcomed = true;
            send({
              type: 'subscribe',
              id: subscription,
              action: request.action,
              ...(request.input !== undefined && { input: request.input }),
              ...(request.after !== undefined && { after: request.after }),
            });
          } else if (message.type === 'error') {
            refuse(message.error);
          }
          return;
        }
        if ('id' in message && message.id !== subscription) return;
        const mapped = eventOf(message);
        if (mapped === undefined) return;
        if (!settled) {
          if (refusing) return;
          if (mapped.kind === 'error') {
            refuse(mapped.error);
            return;
          }
          // The first answer to `s1`: the connection is accepted from here on.
          settled = true;
          queue.push(mapped);
          resolve({ [Symbol.asyncIterator]: () => events });
          return;
        }
        queue.push(mapped);
        notify();
      });
      const onEnd = (): void => {
        // A refusal is on its way: it is the leg's failure, whatever closes the socket after it.
        if (refusing && !settled) return;
        if (!settled) {
          fail(
            clientFailure('core.unavailable', 'The live connection closed before it was ready.'),
          );
          return;
        }
        closed = true;
        signal.removeEventListener('abort', onAbort);
        notify();
      };
      socket.addEventListener('close', onEnd);
      socket.addEventListener('error', onEnd);
    });
}
