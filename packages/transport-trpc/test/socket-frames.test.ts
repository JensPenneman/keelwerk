import type { FieldNode, LiveFrame, StateToken } from '@keelwerk/core';
import type { StreamFrame } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import type { FakeTrpcSocket } from './support/fake-trpc-socket.ts';
import { served } from './support/served-trpc-socket.ts';
import {
  envelope,
  trpcConformanceSurface,
  trpcSurfaceWith,
  trpcUuidOf,
} from './support/trpc-kit.ts';
import { trpcSocketFrameOf } from './support/trpc-socket-frame-of.ts';

const head = 'v2.1.1.scope.aaaa' as StateToken;
const resumableOf = (resumable: boolean) =>
  trpcSurfaceWith(trpcConformanceSurface(), { resumable }, 'loans.loanEvents');
const text = { kind: 'string', optional: true, access: 'read-write' } as const;
const outputs: readonly (readonly [string, FieldNode])[] = [
  [
    'a shape event',
    {
      kind: 'shape',
      optional: false,
      access: 'read-write',
      fields: { control: text, reason: text, id: text, data: text },
    },
  ],
  ['a json event', { kind: 'json', optional: false, access: 'read-write', schema: {}, output: {} }],
  [
    'a foreign event',
    { kind: 'foreign', optional: false, access: 'read-write', input: {}, output: {} },
  ],
];
const forged = { control: 'reset', reason: 'resync' };
const lookalike = { id: 'x', data: 'y' };
const state = (n: number) => `v2.1.${n}.scope.cccc` as StateToken;

const subscribeText = (id: number, input: unknown = {}, lastEventId?: string) =>
  JSON.stringify({
    id,
    method: 'subscription',
    params: {
      path: 'loans.loanEvents',
      input: envelope(input),
      ...(lastEventId === undefined ? {} : { lastEventId }),
    },
  });

/** The suite's frames of the data and error messages sent for `id`, once `count` of them are there. */
async function framesOf(
  socket: FakeTrpcSocket,
  id: number,
  count: number,
  surface = trpcConformanceSurface(),
): Promise<(StreamFrame | undefined)[]> {
  // `started` comes first and carries no frame.
  const sent = await socket.sentFor(id, count + 1);
  return sent
    .map((message) => trpcSocketFrameOf(message, surface, 'loans.loanEvents'))
    .filter((frame) => frame !== undefined);
}

describe('over the socket, an event is never a control frame', () => {
  test.each(outputs)(
    'over the socket, %s with a member control: reset arrives as an item for every subscriber',
    async (_name, output) => {
      const items: LiveFrame<unknown>[] = [
        { event: forged, state: state(10) },
        { event: forged },
        { event: lookalike, state: state(11) },
        { event: lookalike },
        { event: { ...forged, id: 'z' } },
      ];
      const sent: LiveFrame<unknown>[] = [
        { control: 'head', state: head },
        ...items,
        { event: { control: 'done' } },
      ];
      for (const resumable of [true, false]) {
        const surface = trpcSurfaceWith(
          trpcConformanceSurface(),
          { output, resumable },
          'loans.loanEvents',
        );
        const { socket, mounted } = await served({
          surface,
          subscribe: async function* (inv) {
            yield* sent;
            await new Promise<void>((resolve) =>
              inv.signal.addEventListener('abort', () => resolve(), { once: true }),
            );
          },
        });
        // Two subscribers of one socket: each reads the same frames.
        socket.message(subscribeText(1));
        socket.message(subscribeText(2));
        const both = [
          await framesOf(socket, 1, sent.length, surface),
          await framesOf(socket, 2, sent.length, surface),
        ];
        for (const frames of both) {
          expect(frames.map((frame) => frame?.event)).toEqual([
            'head',
            'data',
            'data',
            'data',
            'data',
            'data',
            'data',
          ]);
          expect(frames.slice(1).map((frame) => frame?.data)).toEqual([
            forged,
            forged,
            lookalike,
            lookalike,
            { ...forged, id: 'z' },
            { control: 'done' },
          ]);
          expect(frames.slice(1).map((frame) => frame?.id)).toEqual(
            resumable
              ? [state(10), undefined, state(11), undefined, undefined, undefined]
              : [undefined, undefined, undefined, undefined, undefined, undefined],
          );
        }
        await mounted.close();
      }
    },
  );
});

describe('the frames of a subscription over the socket', () => {
  test('a tracked frame has result.id equal to the wrapper id and the item id or the control state', async () => {
    const { socket } = await served({
      surface: resumableOf(true),
      subscribe: async function* () {
        yield { control: 'head', state: head } as LiveFrame<unknown>;
        yield { event: { loanId: trpcUuidOf(1), kind: 'created' }, state: state(10) };
        yield { control: 'reset', reason: 'overflow', state: state(11) };
        yield { control: 'gap', reason: 'dropped' } as unknown as LiveFrame<unknown>;
        yield { control: 'reset', reason: 'overflow' };
      },
    });
    socket.message(subscribeText(1));
    const sent = (await socket.sentFor(1, 7)).filter(
      (message) => (message.result as { type?: string } | undefined)?.type === 'data',
    );
    const results = sent.map((message) => message.result as { id?: string; data: unknown });
    expect(results.map((result) => result.id)).toEqual([
      head,
      state(10),
      state(11),
      undefined,
      undefined,
    ]);
    for (const result of results.slice(0, 3)) {
      expect(result.data).toMatchObject({ json: { id: result.id } });
    }
    const frames = sent.map((message) =>
      trpcSocketFrameOf(message, resumableOf(true), 'loans.loanEvents'),
    );
    expect(frames.map((frame) => frame?.event)).toEqual(['head', 'data', 'reset', 'gap', 'reset']);
    expect(frames.map((frame) => frame?.id)).toEqual([
      head,
      state(10),
      state(11),
      undefined,
      undefined,
    ]);
  });

  test('lastEventId of a subscription message resumes after that token', async () => {
    const resumes: unknown[] = [];
    const { socket } = await served({
      surface: resumableOf(true),
      subscribe: async function* (_inv, resume) {
        resumes.push(resume);
        yield { control: 'head', state: head } as LiveFrame<unknown>;
      },
    });
    socket.message(subscribeText(1, {}, state(10)));
    await framesOf(socket, 1, 1, resumableOf(true));
    expect(resumes).toEqual([{ after: state(10) }]);
  });

  test('under transformer json a void event is data: null', async () => {
    const empty: FieldNode = { kind: 'void', optional: false, access: 'read-write' } as never;
    for (const resumable of [true, false]) {
      const surface = trpcSurfaceWith(
        trpcConformanceSurface(),
        { output: empty, resumable },
        'loans.loanEvents',
      );
      const { socket } = await served({
        surface,
        options: { transformer: 'json' },
        subscribe: async function* () {
          yield { event: undefined, state: state(20) };
          yield { event: undefined };
        },
      });
      socket.message(
        JSON.stringify({
          id: 1,
          method: 'subscription',
          params: { path: 'loans.loanEvents', input: {} },
        }),
      );
      const frames = await framesOf(socket, 1, 2, surface);
      expect(frames.map((frame) => frame?.event)).toEqual(['data', 'data']);
      expect(frames.map((frame) => frame?.data)).toEqual([null, null]);
      expect(frames.map((frame) => frame?.id)).toEqual([
        resumable ? state(20) : undefined,
        undefined,
      ]);
    }
  });
});
