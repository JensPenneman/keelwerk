import type {
  Carrier,
  Invoker,
  KeelwerkError,
  LiveFrame,
  Logger,
  StateToken,
} from '@keelwerk/core';
import { defineApiVersions, defineApp } from '@keelwerk/core';
import type { TestPrincipal, TestRuntime, TestTenant } from '@keelwerk/testing';
import { startTestRuntime, testCarrier, testPrincipal } from '@keelwerk/testing';
import type { Live } from '../../../src/live-module.ts';
import { live } from '../../../src/live-module.ts';
import { board } from './board-module.ts';

/** The two API versions of the board app: the older one is reached by the `keelwerk-version` header. */
const olderVersion = '2026-11-04';
const headVersion = '2026-11-11';
const api = defineApiVersions({ [olderVersion]: {}, [headVersion]: {} });

function versioned(carrier: Carrier, version: string | undefined): Carrier {
  return version === undefined
    ? carrier
    : { ...carrier, headers: { ...carrier.headers, 'keelwerk-version': version } };
}

const app = defineApp({ id: 'liveboard', modules: [live, board], api });

/** What a started board runs: the live module and the board. */
export type BoardApp = typeof app;

/** The flat event of the board's `cards` subscription. */
export interface CardEvent {
  readonly type: 'created' | 'changed' | 'restored' | 'archived' | 'removed';
  readonly cardId: string;
  readonly version?: number;
  readonly reason?: string;
  readonly cause?: string;
  readonly title?: string;
  readonly note?: string;
  readonly masked?: string;
}

/** What a subscriber was given so far, and how to wait for more. */
export interface Collected {
  readonly frames: LiveFrame<CardEvent>[];
  /** The error `next()` threw, when it did. */
  readonly failure: () => KeelwerkError | undefined;
  readonly ended: () => boolean;
  /** Waits until `count` frames satisfy `test` (or the first `count` frames when none is given). */
  until(test: (frames: readonly LiveFrame<CardEvent>[]) => boolean, ms?: number): Promise<void>;
  /** Waits for the `head` frame: the stream is then attached and everything written later reaches it. */
  ready(): Promise<void>;
  stop(): Promise<void>;
}

/** The principals of the tests. */
export const people = {
  writer: testPrincipal('w', { claims: { seed: true } }),
  ada: testPrincipal('ada'),
  bob: testPrincipal('bob'),
  vic: testPrincipal('vic', { roles: ['viewer'] }),
  eve: testPrincipal('eve'),
};

/** The two API versions of the board app. */
export const boardVersions = { older: olderVersion, head: headVersion } as const;

export type Adapter = 'memory' | 'pglite';

/** A started runtime of the board app, with helpers to write cards and to collect a subscription. */
export interface BoardKit {
  readonly runtime: TestRuntime<BoardApp>;
  readonly invoker: Invoker;
  readonly acme: TestTenant;
  readonly globex: TestTenant;
  /** Runs a command as the writer; throws the error of a failure. */
  write<T = { readonly id: string; readonly version: number }>(
    tenant: TestTenant,
    action: string,
    input: unknown,
  ): Promise<T>;
  /** Runs any action as `who`; throws the error of a failure. */
  call<T = unknown>(
    tenant: TestTenant,
    who: TestPrincipal,
    action: string,
    input: unknown,
  ): Promise<T>;
  /** Opens the `cards` subscription and collects what it yields. */
  subscribe(
    tenant: TestTenant,
    who: TestPrincipal,
    input?: {
      readonly from?: 'now' | 'beginning';
      readonly shownOnly?: boolean;
      readonly includeArchived?: boolean;
      readonly ids?: readonly string[];
    },
    after?: StateToken,
    /** The API version of the request: the head without it. */
    version?: string,
  ): Collected;
  /** The raw iterator of a subscription, for a test that pulls by hand. */
  open(
    tenant: TestTenant,
    who: TestPrincipal,
    input?: Record<string, unknown>,
  ): AsyncIterator<LiveFrame<CardEvent>>;
  stop(): Promise<void>;
}

export async function startBoard(
  adapter: Adapter,
  liveModule: Live = live,
  logger?: Logger,
): Promise<BoardKit> {
  const served =
    liveModule === live ? app : defineApp({ id: 'liveboard', modules: [liveModule, board], api });
  const runtime = await startTestRuntime(served, {
    adapter,
    tenants: ['acme', 'globex'],
    ...(logger === undefined ? {} : { logger }),
  });
  const { invoker } = runtime;
  const { acme, globex } = runtime.tenants;
  const call = async <T>(
    tenant: TestTenant,
    who: TestPrincipal,
    action: string,
    input: unknown,
  ): Promise<T> => {
    const outcome = await invoker.invoke<unknown, T>({
      action,
      input,
      carrier: testCarrier(tenant, who),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: crypto.randomUUID(),
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
  const write = <T>(tenant: TestTenant, action: string, input: unknown): Promise<T> =>
    call<T>(tenant, people.writer, action, input);
  const open: BoardKit['open'] = (tenant, who, input = {}) =>
    invoker
      .subscribe<unknown, CardEvent>({
        action: 'board.cards',
        input,
        carrier: testCarrier(tenant, who),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      })
      [Symbol.asyncIterator]();
  const subscribe: BoardKit['subscribe'] = (tenant, who, input = {}, after, version) => {
    const frames: LiveFrame<CardEvent>[] = [];
    const abort = new AbortController();
    let failure: KeelwerkError | undefined;
    let done = false;
    let wake: (() => void) | undefined;
    const iterator = invoker
      .subscribe<unknown, CardEvent>(
        {
          action: 'board.cards',
          input,
          carrier: versioned(testCarrier(tenant, who), version),
          requestId: crypto.randomUUID(),
          signal: abort.signal,
        },
        after === undefined ? undefined : { after },
      )
      [Symbol.asyncIterator]();
    void (async () => {
      try {
        for (;;) {
          const step = await iterator.next();
          if (step.done === true) break;
          frames.push(step.value);
          wake?.();
        }
      } catch (error) {
        failure = error as KeelwerkError;
      } finally {
        done = true;
        wake?.();
      }
    })();
    const collected: Collected = {
      frames,
      failure: () => failure,
      ended: () => done,
      ready: () => collected.until((got) => got.some((frame) => 'control' in frame)),
      until: async (test, ms = 15_000) => {
        const deadline = Date.now() + ms;
        while (!test(frames)) {
          if (done) {
            if (test(frames)) return;
            throw new Error(
              `the stream ended before the frames matched (${failure?.code ?? 'no error'} ${JSON.stringify(failure?.cause) ?? failure?.message}): ${JSON.stringify(frames, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
            );
          }
          const left = deadline - Date.now();
          if (left <= 0) {
            throw new Error(`timed out; the frames so far: ${JSON.stringify(frames)}`);
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, Math.min(left, 100));
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
      },
      stop: async () => {
        abort.abort();
        await iterator.return?.();
      },
    };
    return collected;
  };
  return {
    runtime,
    invoker,
    acme,
    globex,
    call,
    write,
    subscribe,
    open,
    stop: () => runtime.stop(),
  };
}

/** The state of the last frame that carried one. */
export function lastState(frames: readonly LiveFrame<CardEvent>[]): StateToken {
  for (const frame of [...frames].reverse()) {
    if ('state' in frame && frame.state !== undefined) return frame.state;
  }
  throw new Error('no frame carried a state');
}
