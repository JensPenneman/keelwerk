import type { LiveServerMessage, StateToken, WireError } from '@keelwerk/core';
import { clientFailure } from '../client-failure.ts';
import { errorOfEnvelope } from '../error-of-envelope.ts';
import { isRecord } from '../is-record.ts';
import type { LiveLeg } from '../live-leg.ts';
import type { LiveLegEvent } from '../live-leg-event.ts';
import { outageStatuses } from '../outage-statuses.ts';
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

const livePath = '/_keelwerk/v1/live';

function socketUrl(origin: string): string {
  return `${origin.replace(/^http/, 'ws')}${livePath}`;
}

/**
 * Whether the deployment answers a plain request to the address of the socket. A WebSocket shows no
 * status: an upgrade a gate refuses and one that a down or draining host cannot answer both end in
 * `error` and `close` before ready, so what the host says to the same address without the upgrade
 * tells them apart. A network failure and `outageStatuses` are an outage.
 */
async function deploymentAnswers(state: RemoteClientState, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await state.send(`${state.origin}${livePath}`, { signal });
    await response.body?.cancel();
    return !outageStatuses.has(response.status);
  } catch {
    return false;
  }
}

/**
 * One `keelwerk.live.v1` socket per leg (15.4.7): `hello` with the credential and the selectors,
 * then, once `welcome` arrived, `subscribe` as `s1`. The leg resolves at the server's first answer to
 * `s1` (its first frame), like the server-sent events leg resolves at its first response: an `error`
 * before it, to the `hello` or to `s1`, rejects with that error (so a refused reopen is told apart
 * from a failed stream by what the refusal is) and a close before it with `core.unavailable`. A gate
 * that refuses the upgrade shows only as such a close, like a host that is down. So after a close
 * before ready the leg asks the deployment for the same address over plain HTTP, and counts the close
 * only when the deployment answered with something other than 408, 502, 503 or 504: after
 * `retry.retries` such closes in a row, with no socket of this leg ready in between, the next one
 * rejects with `core.live_unavailable`, which `resumeFrames` does not reopen after. An outage is never
 * counted, so a subscription that has had a frame outlasts a restart during which the plain request
 * fails or is answered with one of those four statuses. A host that refuses the upgrade at its own
 * stream bound answers the plain request like any host, so that refusal is counted the same way today. The events are what the
 * server says of `s1` (and an `error` without an id); a close ends them, and `return()` unsubscribes
 * and closes the socket.
 */
export function openSocketLeg(state: RemoteClientState): LiveLeg {
  /** Sockets of this leg that closed before they were ready, since the last one that was. */
  let closedEarly = 0;
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
      let ending = false;
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
          closedEarly = 0;
          queue.push(mapped);
          resolve({ [Symbol.asyncIterator]: () => events });
          return;
        }
        queue.push(mapped);
        notify();
      });
      const endEarly = async (): Promise<void> => {
        const unavailable = clientFailure(
          'core.unavailable',
          'The live connection closed before it was ready.',
        );
        const answered = await deploymentAnswers(state, signal);
        if (settled) return;
        if (!answered) {
          fail(unavailable);
          return;
        }
        closedEarly += 1;
        fail(
          closedEarly > state.retry.retries
            ? clientFailure(
                'core.live_unavailable',
                `The live connection closed before it was ready ${closedEarly} times in a row while the deployment answered a plain request.`,
              )
            : unavailable,
        );
      };
      const onEnd = (): void => {
        if (!settled) {
          // A refusal is on its way: it is the leg's failure, whatever closes the socket after it.
          if (refusing || ending) return;
          ending = true;
          void endEarly();
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
