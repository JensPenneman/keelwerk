import { type FieldNode, type LiveFrame, type StateToken, versionProjection } from '@keelwerk/core';
import type { StreamFrame } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import {
  mountedTrpc,
  sendTrpc,
  trpcConformanceSurface,
  trpcSurfaceWith,
  trpcUuidOf,
} from './support/trpc-kit.ts';
import { messages } from './support/trpc-sse-messages.ts';
import { trpcFrameOf } from './support/trpc-subscribe-over.ts';

const head = 'v2.1.1.scope.aaaa' as StateToken;
const open = { accept: 'text/event-stream' };
const resumable = (ref = 'loans.loanEvents') =>
  trpcSurfaceWith(trpcConformanceSurface(), { resumable: true }, ref);

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

describe('an event is never a control frame', () => {
  test.each(outputs)(
    'for every subscriber, %s with a member control: reset arrives as an item',
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
        const mounted = await mountedTrpc(surface, () => ({ ok: true, value: undefined }), {
          subscribe: async function* (inv) {
            yield* sent;
            await new Promise<void>((resolve) =>
              inv.signal.addEventListener('abort', () => resolve(), { once: true }),
            );
          },
        });
        const read = async (): Promise<StreamFrame[]> => {
          const response = await sendTrpc(mounted.handler, 'loans.loanEvents', { headers: open });
          return await messages(response, sent.length);
        };
        // Two subscribers of one audience: each reads the same frames.
        const both = await Promise.all([read(), read()]);
        for (const events of both) {
          const frames = events.map((event) => trpcFrameOf(event, surface, 'loans.loanEvents'));
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
          // The ids come only from the states of the frames.
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

describe('a reset with a state is tracked', () => {
  test('its id is its state, and resubscribing from it delivers the dropped items once', async () => {
    const log = [10, 11, 12].map((n) => ({
      event: { loanId: trpcUuidOf(n), kind: 'created' },
      state: state(n),
    }));
    const resumes: unknown[] = [];
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      () => ({ ok: true, value: undefined }),
      {
        surfaces: versionProjection(['2026-11-11'], () => resumable()),
        subscribe: async function* (_inv, resume) {
          resumes.push(resume);
          if (resume === undefined) {
            // The queue overflowed after the first item: the second and third are dropped.
            yield { control: 'head', state: head } as const;
            yield log[0] as LiveFrame<unknown>;
            yield { control: 'reset', reason: 'overflow', state: state(10) } as const;
            return;
          }
          for (const entry of log) if (entry.state > resume.after) yield entry;
        },
      },
    );
    const surface = resumable();
    const read = async (headers: Record<string, string>): Promise<StreamFrame[]> => {
      const response = await sendTrpc(mounted.handler, 'loans.loanEvents', { headers });
      return await messages(response, 5);
    };
    const first = (await read(open)).map((event) =>
      trpcFrameOf(event, surface, 'loans.loanEvents'),
    );
    const reset = first.at(-1);
    expect(first.map((frame) => frame?.event)).toEqual(['head', 'data', 'reset']);
    expect(reset).toMatchObject({ event: 'reset', id: state(10), data: { state: state(10) } });
    const again = (await read({ ...open, 'last-event-id': reset?.id ?? '' })).map((event) =>
      trpcFrameOf(event, surface, 'loans.loanEvents'),
    );
    expect(resumes).toEqual([undefined, { after: state(10) }]);
    expect(again.map((frame) => frame?.event)).toEqual(['data', 'data']);
    expect(again.map((frame) => frame?.id)).toEqual([state(11), state(12)]);
  });
});

describe("an item with no event under transformer 'json'", () => {
  const empty = { kind: 'void', optional: false, access: 'read-write' } as const;

  test.each([true, false])(
    'is an item with data null, as a resumable action: %s',
    async (resumable) => {
      const surface = trpcSurfaceWith(
        trpcConformanceSurface(),
        { output: empty, resumable },
        'loans.loanEvents',
      );
      const mounted = await mountedTrpc(surface, () => ({ ok: true, value: undefined }), {
        options: { transformer: 'json' },
        subscribe: async function* () {
          yield { event: undefined, state: state(20) };
          yield { event: undefined };
        },
      });
      const response = await sendTrpc(mounted.handler, 'loans.loanEvents', { headers: open });
      const events = await messages(response, 2);
      const frames = events.map((event) => trpcFrameOf(event, surface, 'loans.loanEvents'));
      expect(frames.map((frame) => frame?.event)).toEqual(['data', 'data']);
      expect(frames.map((frame) => frame?.data)).toEqual([null, null]);
      expect(frames.map((frame) => frame?.id)).toEqual([
        resumable ? state(20) : undefined,
        undefined,
      ]);
      await mounted.close();
    },
  );
});

describe('a subscription with a scalar input', () => {
  test('that does not resume reaches the invoker with the input as it was sent', async () => {
    const scalar = {
      kind: 'foreign',
      optional: false,
      access: 'read-write',
      input: { type: 'string' },
      output: { type: 'object' },
    } as const;
    const surface = trpcSurfaceWith(
      trpcConformanceSurface(),
      { input: scalar, output: scalar, resumable: false },
      'loans.loanEvents',
    );
    const mounted = await mountedTrpc(surface, () => ({ ok: true, value: undefined }), {
      subscribe: async function* () {
        yield { event: { n: 1 } };
      },
    });
    const response = await sendTrpc(mounted.handler, 'loans.loanEvents', {
      headers: open,
      search: `input=${encodeURIComponent(JSON.stringify({ json: 'x' }))}`,
    });
    const events = await messages(response, 1);
    expect(events.map((event) => trpcFrameOf(event, surface, 'loans.loanEvents')?.data)).toEqual([
      { n: 1 },
    ]);
    expect(mounted.subscribed.map((inv) => inv.input)).toEqual(['x']);
    await mounted.close();
  });
});
