import type { ApiSurface, HttpContext, LiveFrame, SurfaceAction } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import type { RestHandlerDeps } from '../src/rest-handler-deps.ts';
import type { RestRoute } from '../src/rest-route.ts';
import { serveSubscription } from '../src/subscriptions/serve-subscription.ts';

const action = {
  ref: 'loans.loanEvents',
  kind: 'subscription',
  input: { optional: false, access: 'read-write', kind: 'void' },
  output: { optional: false, access: 'read-write', kind: 'string' },
} as unknown as SurfaceAction;
const route = { method: 'GET', path: '/events', action } as unknown as RestRoute;
const surface = { hash: 'hash-1' } as unknown as ApiSurface;
const failure = new Error('the source failed');

/**
 * What the invoker does for one subscription: it holds a slot from its first `next()` until the
 * iterator is returned, ends, or its signal aborts. `how` says what the source does after its first frame.
 */
function invokerOf(how: 'wait' | 'fail' | 'refuse') {
  const held = { count: 0, signals: [] as AbortSignal[] };
  const invoker = {
    subscribe: (invocation: { readonly signal: AbortSignal }) => {
      held.signals.push(invocation.signal);
      let step = 0;
      let holding = false;
      const give = (): void => {
        if (holding) held.count -= 1;
        holding = false;
      };
      const iterator: AsyncIterator<LiveFrame<unknown>> = {
        next() {
          step += 1;
          if (how === 'refuse') return Promise.reject(failure);
          if (step === 1) {
            holding = true;
            held.count += 1;
            return Promise.resolve({ done: false, value: { event: 'one' } });
          }
          if (how === 'fail') {
            give();
            return Promise.reject(failure);
          }
          return new Promise((resolve) =>
            invocation.signal.addEventListener(
              'abort',
              () => {
                give();
                resolve({ done: true, value: undefined });
              },
              { once: true },
            ),
          );
        },
        return() {
          give();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
      return { [Symbol.asyncIterator]: () => iterator };
    },
  };
  return { invoker, held };
}

/** The request's signal, with the listeners the route has on it counted. */
function requestSignal() {
  const controller = new AbortController();
  const listening = { count: 0 };
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  vi.spyOn(controller.signal, 'addEventListener').mockImplementation((...args) => {
    listening.count += 1;
    add(...args);
  });
  vi.spyOn(controller.signal, 'removeEventListener').mockImplementation((...args) => {
    listening.count -= 1;
    remove(...args);
  });
  return { controller, listening };
}

function open(
  how: 'wait' | 'fail' | 'refuse',
  serve?: HttpContext['serveStream'],
  abortedAlready = false,
) {
  const { invoker, held } = invokerOf(how);
  const { controller, listening } = requestSignal();
  if (abortedAlready) controller.abort();
  const served: { frames?: AsyncIterable<LiveFrame<unknown>> } = {};
  const ctx = {
    session: {},
    carrier: {},
    requestId: 'r1',
    signal: controller.signal,
    serveStream:
      serve ??
      ((frames: AsyncIterable<LiveFrame<unknown>>) => {
        served.frames = frames;
        return new Response(null);
      }),
  } as unknown as HttpContext;
  const response = serveSubscription(
    { invoker } as unknown as RestHandlerDeps,
    surface,
    new Request('https://shop.example/events', { headers: { accept: 'text/event-stream' } }),
    ctx,
    route,
  );
  return { response, held, controller, listening, served };
}

describe('a REST subscription route and the slot of its subscription', () => {
  test('takes the subscription for the stream and gives it back, and the request listener with it, when the host closes the stream', async () => {
    const made = open('wait');
    await made.response;
    expect(made.held.count).toBe(1);
    expect(made.listening.count).toBe(1);
    const iterator = made.served.frames?.[Symbol.asyncIterator]();
    await iterator?.return?.(undefined);
    expect(made.held.count).toBe(0);
    expect(made.held.signals[0]?.aborted).toBe(true);
    expect(made.listening.count).toBe(0);
  });

  test('a request that aborted before the route ran aborts its subscription from the start', () => {
    const made = open('wait', undefined, true);
    expect(made.held.signals[0]?.aborted).toBe(true);
    void made.response.catch(() => undefined);
  });

  test('gives it back when the request aborts, and the stream then ends', async () => {
    const made = open('wait');
    await made.response;
    const iterator = made.served.frames?.[Symbol.asyncIterator]();
    await iterator?.next();
    const next = iterator?.next();
    made.controller.abort();
    expect(await next).toMatchObject({ done: true });
    expect(made.held.count).toBe(0);
    expect(made.held.signals[0]?.aborted).toBe(true);
    expect(made.listening.count).toBe(0);
  });

  test('gives it back when the source fails after the first frame, and the failure reaches the host', async () => {
    const made = open('fail');
    await made.response;
    const iterator = made.served.frames?.[Symbol.asyncIterator]();
    await iterator?.next();
    await expect(iterator?.next()).rejects.toBe(failure);
    expect(made.held.count).toBe(0);
    expect(made.held.signals[0]?.aborted).toBe(true);
    expect(made.listening.count).toBe(0);
  });

  test('holds nothing when the setup is refused: the host is never asked for a stream', async () => {
    const serve = vi.fn(() => new Response(null));
    const made = open('refuse', serve);
    await expect(made.response).rejects.toBe(failure);
    expect(serve).not.toHaveBeenCalled();
    expect(made.held.count).toBe(0);
    expect(made.held.signals[0]?.aborted).toBe(true);
    expect(made.listening.count).toBe(0);
  });

  test('gives it back when the host cannot start the response', async () => {
    const refused = new Error('the host refused');
    const made = open('wait', () => {
      throw refused;
    });
    await expect(made.response).rejects.toBe(refused);
    expect(made.held.count).toBe(0);
    expect(made.held.signals[0]?.aborted).toBe(true);
    expect(made.listening.count).toBe(0);
  });
});
