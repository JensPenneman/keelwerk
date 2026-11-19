import type { LiveFrame, StateToken, WireError } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import type { LiveLeg, LiveLegRequest } from '../../src/live-leg.ts';
import type { LiveLegEvent } from '../../src/live-leg-event.ts';
import { resumeFrames } from '../../src/resume-frames.ts';
import type { RetryPolicy } from '../../src/retry-policy.ts';

const token = (n: number): StateToken => `v2.0.${n}.00000000.${'0'.repeat(32)}` as StateToken;
const retry: RetryPolicy = {
  retries: 2,
  baseDelayMs: 1,
  maxDelayMs: 1,
  random: () => 0.5,
  sleep: () => Promise.resolve(),
};
const item = (event: string, state?: StateToken): LiveLegEvent => ({
  kind: 'frame',
  frame: { event, ...(state !== undefined && { state }) },
});
const head = (state: StateToken): LiveLegEvent => ({
  kind: 'frame',
  frame: { control: 'head', state },
});
const wire = (code: string): WireError => ({
  kind: 'internal',
  code,
  message: code,
  retryable: false,
  requestId: 'r',
});

/** One scripted connection: the events it yields, then how it ends. */
type Script =
  | { readonly refuse: unknown }
  | {
      readonly events: readonly LiveLegEvent[];
      readonly ending?: 'end' | 'hang' | { readonly fail: unknown };
    };

function legOf(scripts: readonly Script[]): {
  open: LiveLeg;
  requests: LiveLegRequest[];
  aborted: boolean[];
  closed: number[];
} {
  const requests: LiveLegRequest[] = [];
  const aborted: boolean[] = [];
  const closed: number[] = [];
  const open: LiveLeg = async (request, signal) => {
    const index = requests.length;
    requests.push(request);
    aborted.push(false);
    signal.addEventListener('abort', () => {
      aborted[index] = true;
    });
    const script = scripts[index];
    if (script === undefined) throw new Error(`The test opened connection ${index + 1}.`);
    if ('refuse' in script) throw script.refuse;
    const queue = [...script.events];
    const iterator: AsyncIterator<LiveLegEvent> = {
      next: () => {
        const next = queue.shift();
        if (next !== undefined) return Promise.resolve({ done: false, value: next });
        if (script.ending === 'hang') {
          return new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve({ done: true, value: undefined }));
          });
        }
        if (typeof script.ending === 'object') return Promise.reject(script.ending.fail);
        return Promise.resolve({ done: true, value: undefined });
      },
      return: () => {
        closed.push(index);
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  };
  return { open, requests, aborted, closed };
}

async function collect(frames: AsyncIterable<LiveFrame<unknown>>): Promise<LiveFrame<unknown>[]> {
  const out: LiveFrame<unknown>[] = [];
  for await (const frame of frames) out.push(frame);
  return out;
}

const options = {
  retry,
  dropped: (failure: unknown) => failure instanceof Error && failure.message === 'dropped',
  failure: (error: WireError) => new Error(`wire ${error.code}`),
};
const dropped = new Error('dropped');

describe('resumeFrames', () => {
  it('yields the frames and ends at end complete', async () => {
    const leg = legOf([
      { events: [head(token(1)), item('a', token(2)), { kind: 'end', reason: 'complete' }] },
    ]);
    const frames = await collect(
      resumeFrames(leg.open, { action: 'x.y', input: { n: 1 } }, options),
    );
    expect(frames).toEqual([
      { control: 'head', state: token(1) },
      { event: 'a', state: token(2) },
    ]);
    expect(leg.requests).toEqual([{ action: 'x.y', input: { n: 1 } }]);
  });

  it('reopens from the last token after a connection that ended without end, and after going_away and max_duration', async () => {
    const leg = legOf([
      { events: [item('a', token(2))] },
      { events: [{ kind: 'end', reason: 'going_away' }] },
      { events: [head(token(5)), { kind: 'end', reason: 'max_duration' }] },
      { events: [item('b', token(6)), { kind: 'end', reason: 'complete' }] },
    ]);
    const frames = await collect(resumeFrames(leg.open, { action: 'x.y' }, options));
    expect(frames.map((frame) => ('event' in frame ? frame.event : frame.control))).toEqual([
      'a',
      'head',
      'b',
    ]);
    expect(leg.requests.map((request) => request.after)).toEqual([
      undefined,
      token(2),
      token(2),
      token(5),
    ]);
  });

  it('starts after the token it was given', async () => {
    const leg = legOf([{ events: [{ kind: 'end', reason: 'complete' }] }]);
    await collect(resumeFrames(leg.open, { action: 'x.y' }, { ...options, after: token(9) }));
    expect(leg.requests[0]?.after).toBe(token(9));
  });

  it('gives up with the last failure after the retries when no frame ever came', async () => {
    const last = new Error('dropped');
    const leg = legOf([{ refuse: dropped }, { refuse: dropped }, { refuse: last }]);
    const iterator = resumeFrames(leg.open, { action: 'x.y' }, options)[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBe(last);
    expect(leg.requests).toHaveLength(3);
  });

  it('ends with core.unavailable when every connection closes before a frame', async () => {
    const leg = legOf([{ events: [] }, { events: [] }, { events: [] }]);
    await expect(collect(resumeFrames(leg.open, { action: 'x.y' }, options))).rejects.toThrow(
      'wire core.unavailable',
    );
    expect(leg.requests).toHaveLength(3);
  });

  it('never gives up once a frame came: five failed opens, then the stream goes on', async () => {
    const leg = legOf([
      { events: [item('a', token(1))] },
      { refuse: dropped },
      { refuse: dropped },
      { refuse: dropped },
      { refuse: dropped },
      { refuse: dropped },
      { events: [item('b', token(2)), { kind: 'end', reason: 'complete' }] },
    ]);
    const frames = await collect(resumeFrames(leg.open, { action: 'x.y' }, options));
    expect(frames).toHaveLength(2);
    expect(leg.requests.at(-1)?.after).toBe(token(1));
  });

  it('treats a connection that breaks while running as dropped, and any other failure as final', async () => {
    const leg = legOf([
      { events: [item('a', token(1))], ending: { fail: dropped } },
      { events: [item('b', token(2))], ending: { fail: new Error('fatal') } },
    ]);
    const iterator = resumeFrames(leg.open, { action: 'x.y' }, options)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ event: 'a', state: token(1) });
    expect((await iterator.next()).value).toEqual({ event: 'b', state: token(2) });
    await expect(iterator.next()).rejects.toThrow('fatal');
    expect((await iterator.next()).done).toBe(true);
  });

  it('throws an error event and version_retired through the failure mapping', async () => {
    const failing = legOf([{ events: [{ kind: 'error', error: wire('x.broken') }] }]);
    await expect(collect(resumeFrames(failing.open, { action: 'x.y' }, options))).rejects.toThrow(
      'wire x.broken',
    );
    const retired = legOf([{ events: [{ kind: 'end', reason: 'version_retired' }] }]);
    await expect(collect(resumeFrames(retired.open, { action: 'x.y' }, options))).rejects.toThrow(
      'wire core.api_version_retired',
    );
  });

  it('reopens from the state of a reset overflow and does not yield it', async () => {
    const leg = legOf([
      {
        events: [
          item('a', token(1)),
          { kind: 'frame', frame: { control: 'reset', reason: 'overflow', state: token(4) } },
        ],
      },
      { events: [item('b', token(5)), { kind: 'end', reason: 'complete' }] },
    ]);
    const frames = await collect(resumeFrames(leg.open, { action: 'x.y' }, options));
    expect(frames).toEqual([
      { event: 'a', state: token(1) },
      { event: 'b', state: token(5) },
    ]);
    expect(leg.requests[1]?.after).toBe(token(4));
    expect(leg.closed).toContain(0);
  });

  it('yields any other reset, then reopens with the input and no token', async () => {
    const leg = legOf([
      {
        events: [
          item('a', token(1)),
          { kind: 'frame', frame: { control: 'reset', reason: 'resync' } },
        ],
      },
      { events: [head(token(7)), { kind: 'end', reason: 'complete' }] },
    ]);
    const frames = await collect(
      resumeFrames(leg.open, { action: 'x.y', input: { k: 1 } }, options),
    );
    expect(frames).toEqual([
      { event: 'a', state: token(1) },
      { control: 'reset', reason: 'resync' },
      { control: 'head', state: token(7) },
    ]);
    expect(leg.requests[1]).toEqual({ action: 'x.y', input: { k: 1 } });
  });

  it('return() with a next() pending aborts and closes the open connection at once', async () => {
    const leg = legOf([{ events: [item('a', token(1))], ending: 'hang' }]);
    const iterator = resumeFrames(leg.open, { action: 'x.y' }, options)[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    await iterator.return?.();
    expect(leg.aborted[0]).toBe(true);
    expect(leg.closed).toEqual([0]);
    expect((await pending).done).toBe(true);
  });

  it('ends quietly when the signal aborts', async () => {
    const controller = new AbortController();
    const leg = legOf([{ events: [item('a', token(1))], ending: 'hang' }]);
    const iterator = resumeFrames(
      leg.open,
      { action: 'x.y' },
      { ...options, signal: controller.signal },
    )[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    expect(leg.aborted[0]).toBe(true);
  });
});
