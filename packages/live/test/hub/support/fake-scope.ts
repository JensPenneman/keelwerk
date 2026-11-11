import type {
  KeelwerkError,
  LiveEarlier,
  LiveEarlierShare,
  LiveKernel,
  LiveView,
  Unit,
} from '@keelwerk/core';
import { vi } from 'vitest';
import type { ReaderBatch } from '../../../src/hub/reader-batch.ts';
import type { ReaderListener } from '../../../src/hub/reader-listener.ts';
import { resolveHubLimits } from '../../../src/hub/resolve-hub-limits.ts';
import { createScopeReader } from '../../../src/hub/scope-reader.ts';

/** The log lines a reader wrote, with their fields. */
interface Line {
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

/** A stored log of the reader: ids and counts only, so the tests can assert nothing else was written. */
function capturingLog(lines: Line[]) {
  const log = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string, fields?: Readonly<Record<string, unknown>>) => {
      lines.push({ message, fields });
    },
    error: () => undefined,
    child: () => log,
  };
  return log;
}

/** The statements a pass sent to its unit, by kind. */
interface Statements {
  head: number;
  readAll: number;
  find: number;
}

/** A scope whose log the tests control: the head, the events and what each read costs. */
function fakeScope(
  options: {
    readonly readStalls?: () => Promise<void> | undefined;
    readonly audience?: string;
  } = {},
) {
  const lines: Line[] = [];
  const statements: Statements = { head: 0, readAll: 0, find: 0 };
  const state = { head: 0n, reads: 0, events: [] as { position: bigint; id: string }[] };
  const unit = {
    events: {
      head: async () => {
        statements.head += 1;
        return state.head;
      },
      readAll: async (after: bigint | null, query: { limit: number }) => {
        statements.readAll += 1;
        const list = state.events
          .filter((event) => event.position > (after ?? 0n))
          .slice(0, query.limit)
          .map((event) => ({
            position: event.position,
            stream: { type: 't.card', id: event.id },
            type: 't.card.changed',
            partition: null,
          }));
        return { events: list, next: list.length === 0 ? null : (list.at(-1)?.position ?? null) };
      },
    },
    rows: {
      find: async (
        _descriptor: unknown,
        query: { where: { value: string | readonly string[] } },
      ) => {
        statements.find += 1;
        const ids = [query.where.value].flat();
        return { rows: ids.map((id) => ({ id, version: 1 })) };
      },
    },
  } as unknown as Unit;
  const kernel = {
    entity: 't.card',
    descriptor: {},
    scopeId: 'scope-1',
    audience: options.audience ?? 'tenant-1',
    log: capturingLog(lines),
    read: async <T>(fn: (unit: Unit) => Promise<T>): Promise<T> => {
      state.reads += 1;
      await options.readStalls?.();
      return fn(unit);
    },
  } as unknown as LiveKernel;
  const commit = (id: string): bigint => {
    state.head += 1n;
    state.events.push({ position: state.head, id });
    return state.head;
  };
  return { kernel, lines, state, statements, commit, unit };
}

/** A view that counts what the reader asks of it. */
function fakeView(
  planKey: string,
  earlier?: (unit: Unit, ids: readonly string[]) => Promise<LiveEarlier>,
) {
  const view = {
    entity: 't.card',
    planKey,
    inPlan: vi.fn(async (_unit: Unit, rows: readonly unknown[]) => rows.map(() => true)),
    present: vi.fn(async (_unit: Unit, rows: readonly unknown[]) => rows),
    earlier: vi.fn(
      async (
        unit: Unit,
        request: { readonly ids: readonly string[]; readonly share?: LiveEarlierShare },
      ): Promise<LiveEarlier> =>
        earlier === undefined ? { rows: new Map(), uncertain: false } : earlier(unit, request.ids),
    ),
  };
  return view as typeof view & LiveView;
}

function fakeListener(view?: LiveView, undecided?: ReaderListener['undecided']) {
  const joined: bigint[] = [];
  const batches: ReaderBatch[] = [];
  const failures: KeelwerkError[] = [];
  const ends: number[] = [];
  const listener: ReaderListener = {
    ...(view === undefined ? {} : { view }),
    ...(undecided === undefined ? {} : { undecided }),
    join: (at) => {
      joined.push(at);
    },
    deliver: (batch) => {
      batches.push(batch);
    },
    fail: (error) => {
      failures.push(error);
    },
    end: () => {
      ends.push(1);
    },
  };
  return { listener, joined, batches, failures, ends };
}

const limits = (over: Parameters<typeof resolveHubLimits>[0] = {}) =>
  resolveHubLimits({ pollMs: 20, passTimeoutMs: 200, ...over });

function readerOf(scope: ReturnType<typeof fakeScope>, over: Parameters<typeof limits>[0] = {}) {
  const wakes = new Set<() => void>();
  const stopped = vi.fn();
  const unwatched = vi.fn();
  const reader = createScopeReader({
    kernel: scope.kernel,
    limits: limits(over),
    onWake: (wake) => {
      wakes.add(wake);
      return () => {
        unwatched();
        wakes.delete(wake);
      };
    },
    onStop: stopped,
  });
  return {
    reader,
    wake: () => {
      for (const wake of wakes) wake();
    },
    stopped,
    unwatched,
  };
}

export type { Line };
export { fakeListener, fakeScope, fakeView, limits, readerOf };
