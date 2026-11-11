import { describe, expect, test } from 'vitest';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StateToken } from '../events/state-token.ts';
import type { InvocationDecision } from '../invoker/decision-hook.ts';
import type { Invocation } from '../invoker/invocation.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import type { Outcome } from '../invoker/outcome.ts';
import { explainDecisions } from './explain-decisions.ts';
import { explainStream } from './explain-stream.ts';

const clock = { now: () => Temporal.Instant.fromEpochMilliseconds(1000) };
const flag = 'KEELWERK_EXPLAIN';
const on = { development: true, env: { [flag]: '1' } };

function inv(requestId = 'r1'): Invocation<unknown> {
  return {
    action: 'a.x',
    input: {},
    requestId,
    carrier: { transport: 'test' },
    signal: new AbortController().signal,
  };
}

function decision(over: Partial<InvocationDecision> = {}): InvocationDecision {
  return {
    kind: 'invoke',
    requestId: 'r1',
    action: 'a.x',
    transport: 'test',
    stage: 'complete',
    rules: [],
    ...over,
  };
}

const resumed: ({ readonly after: StateToken } | undefined)[] = [];

function fake(outcome: Outcome<unknown>, frames: () => AsyncIterable<LiveFrame<unknown>>): Invoker {
  return {
    open: async () => {
      throw new Error('not used');
    },
    invoke: async <I, O>(_inv: Invocation<I>) => outcome as Outcome<O>,
    subscribe: <I, E>(_inv: Invocation<I>, resume?: { readonly after: StateToken }) => {
      resumed.push(resume);
      return frames() as AsyncIterable<LiveFrame<E>>;
    },
  };
}

const noFrames = () => ({
  async *[Symbol.asyncIterator]() {},
});

function setup(
  outcome: Outcome<unknown>,
  frames: () => AsyncIterable<LiveFrame<unknown>> = noFrames,
) {
  const lines: string[] = [];
  const decisions = explainDecisions(on);
  if (decisions === undefined) throw new Error('the stream is on');
  const invoker = explainStream(fake(outcome, frames), {
    ...on,
    write: (line) => lines.push(line),
    clock,
    decisions,
  });
  return { lines, decisions, invoker };
}

const forbidden = new KeelwerkError({ kind: 'forbidden', code: 'core.forbidden', message: 'no' });

describe('the explain stream line', () => {
  test('adds the matched rule ids to the line', async () => {
    const { lines, decisions, invoker } = setup({ ok: true, value: 1 });
    decisions.onDecision(
      decision({
        rules: [
          { id: 'a.x', effect: 'allow' },
          { id: 'a.y', effect: 'allow' },
        ],
      }),
    );
    await invoker.invoke(inv());
    expect(lines).toEqual(['test -> a.x ok 0 ms rules=a.x,a.y']);
  });

  test('names the stage a failed invocation stopped at', async () => {
    const { lines, decisions, invoker } = setup({ ok: false, error: forbidden });
    decisions.onDecision(
      decision({ stage: 'authorize', rules: [{ id: 'a.d', effect: 'deny' }], error: forbidden }),
    );
    await invoker.invoke(inv());
    expect(lines).toEqual(['test -> a.x core.forbidden 0 ms rules=a.d stage=authorize']);
  });

  test('prints rules=- when the invoker reported no decision', async () => {
    const { lines, invoker } = setup({ ok: true, value: 1 });
    await invoker.invoke(inv());
    const bare = explainStream(fake({ ok: true, value: 1 }, noFrames), {
      ...on,
      write: (line) => lines.push(line),
      clock,
    });
    await bare.invoke(inv());
    const empty = explainStream(fake({ ok: true, value: 1 }, noFrames), {
      ...on,
      write: (line) => lines.push(line),
      clock,
      decisions: { onDecision: () => {}, take: () => undefined },
    });
    await empty.invoke(inv());
    expect(lines).toEqual([
      'test -> a.x ok 0 ms rules=-',
      'test -> a.x ok 0 ms rules=-',
      'test -> a.x ok 0 ms rules=-',
    ]);
  });

  test('writes one line for a subscription when its first frame arrives', async () => {
    const frames = () => ({
      async *[Symbol.asyncIterator]() {
        yield { control: 'gap' } as const;
        yield { control: 'gap', missed: 2 } as const;
      },
    });
    const { lines, invoker } = setup({ ok: true, value: 1 }, frames);
    const seen: unknown[] = [];
    for await (const frame of invoker.subscribe(inv())) seen.push(frame);
    expect(seen).toEqual([{ control: 'gap' }, { control: 'gap', missed: 2 }]);
    expect(lines).toEqual(['test -> a.x ok 0 ms rules=- kind=subscribe']);
  });

  test('writes one line for a subscription that fails before its first frame', async () => {
    const unavailable = new KeelwerkError({
      kind: 'unavailable',
      code: 'core.live_unavailable',
      message: 'no',
    });
    const frames = () => ({
      // biome-ignore lint/correctness/useYield: fails before a frame
      async *[Symbol.asyncIterator]() {
        throw unavailable;
      },
    });
    const { lines, invoker } = setup({ ok: true, value: 1 }, frames);
    await expect(async () => {
      for await (const _frame of invoker.subscribe(inv())) {
        // never reached
      }
    }).rejects.toBe(unavailable);
    expect(lines).toEqual(['test -> a.x core.live_unavailable 0 ms rules=- kind=subscribe']);
  });

  test('writes a line when return() comes before the first next(), and one line for each subscription', async () => {
    const frames = () => ({
      async *[Symbol.asyncIterator]() {
        yield { control: 'gap' } as const;
      },
    });
    const { lines, invoker } = setup({ ok: true, value: 1 }, frames);
    const stream = invoker.subscribe(inv());
    const closed = stream[Symbol.asyncIterator]();
    await closed.return?.();
    expect(lines).toEqual(['test -> a.x ok 0 ms rules=- kind=subscribe']);
    // A second iterator of the same subscription writes no second line.
    const again = stream[Symbol.asyncIterator]();
    await again.next();
    await again.return?.();
    expect(lines).toHaveLength(1);
  });
});

describe('the explain stream and a resumed subscription', () => {
  test('subscribe passes resume to the inner invoker', async () => {
    const { invoker } = setup({ ok: true, value: {} });
    const after = 'v1.0.5.aaaaaaaa.bbbbbbbb' as StateToken;
    for await (const _frame of invoker.subscribe(inv(), { after })) {
      // no frames
    }
    expect(resumed.at(-1)).toEqual({ after });
  });
});

describe('explainDecisions', () => {
  test('is undefined outside development or without KEELWERK_EXPLAIN=1', () => {
    expect(explainDecisions({ development: false, env: { [flag]: '1' } })).toBeUndefined();
    expect(explainDecisions({ development: true, env: {} })).toBeUndefined();
    expect(explainDecisions({ development: true, env: { [flag]: '0' } })).toBeUndefined();
  });

  test('keeps the newest 256 untaken decisions', () => {
    const store = explainDecisions(on);
    if (store === undefined) throw new Error('the stream is on');
    for (let index = 0; index < 257; index += 1) {
      store.onDecision(decision({ requestId: `r${index}` }));
    }
    expect(store.take('r0')).toBeUndefined();
    expect(store.take('r1')?.requestId).toBe('r1');
    expect(store.take('r1')).toBeUndefined();
    expect(store.take('r256')?.requestId).toBe('r256');
  });
});
