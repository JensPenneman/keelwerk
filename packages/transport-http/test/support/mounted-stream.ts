import type { InvocationSession } from '@keelwerk/core';
import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { createFakeInvoker } from './fake-invoker.ts';
import { libraryActions } from './library-actions.ts';
import { pinnedTime } from './pinned-time.ts';
import type { useHosts } from './use-hosts.ts';

export interface RouteRecord {
  readonly contextSignals: AbortSignal[];
  readonly requestSignals: AbortSignal[];
  cancelled: number;
}

export function mounted(
  setup: ReturnType<typeof useHosts>['setup'],
  session: InvocationSession | ((opened: number) => InvocationSession),
  extra: {
    maxDurationMs?: number;
    revalidateMs?: number;
    /** The media type the route answers in; an event stream when absent. */
    contentType?: string;
    /** Receives the controller of each route body, for a route that keeps enqueuing. */
    keep?: (controller: ReadableStreamDefaultController<Uint8Array>) => void;
  } = {},
) {
  const time = pinnedTime();
  const lines: LoggedLine[] = [];
  let opened = 0;
  const made = setup(
    {
      live: { maxDurationMs: extra.maxDurationMs ?? 30_000, maxStreamsPerPrincipal: 1 },
      liveSocket: { revalidateMs: extra.revalidateMs ?? 5_000 },
    },
    createFakeInvoker({
      actions: libraryActions,
      open: () => ({
        ok: true,
        value: typeof session === 'function' ? session(opened++) : session,
      }),
    }),
    { clock: time.clock, timers: time.timers, log: recordingLogger(lines) },
  );
  const record: RouteRecord = { contextSignals: [], requestSignals: [], cancelled: 0 };
  made.host.route(
    { app: 'library', transport: 'sse-test', prefix: '/events' },
    async (request, ctx) => {
      record.contextSignals.push(ctx.signal);
      record.requestSignals.push(request.signal);
      return new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(new TextEncoder().encode('data: first\n\n'));
            extra.keep?.(controller);
          },
          cancel: () => {
            record.cancelled += 1;
          },
        }),
        { headers: { 'content-type': extra.contentType ?? 'text/event-stream' } },
      );
    },
  );
  const open = (address = '198.18.0.5') =>
    made.host.fetch(
      new Request('https://library.example/events/x', { headers: { accept: 'text/event-stream' } }),
      { remoteAddress: address },
    );
  const ended = (): LoggedLine[] =>
    lines.filter((line) => line.message === 'stream ended by the host');
  return { ...made, ...time, record, open, lines, ended };
}
