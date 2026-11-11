import type { LiveFrame, StateToken } from '@keelwerk/core';
import { readEventStream } from '@keelwerk/testing';
import { afterEach, describe, expect, test } from 'vitest';
import { type StreamHost, streamHost } from './support/stream-host.ts';

const token = (n: number): StateToken =>
  `v2.0.${n}.00000000.00000000000000000000000000000000` as StateToken;

const hosts: StreamHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

function started(frames: readonly LiveFrame<unknown>[]): StreamHost {
  const made = streamHost(() =>
    (async function* () {
      yield* frames;
    })(),
  );
  hosts.push(made);
  return made;
}

describe('a reset is the last frame of its stream', () => {
  test('after a reset overflow the body ends with no end event, and no later frame is sent', async () => {
    const made = started([
      { event: 'one', state: token(1) },
      { control: 'reset', reason: 'overflow', state: token(1) },
      { event: 'never', state: token(2) },
    ]);
    const text = await (await made.open()).text();
    expect(text).toContain(
      `id: ${token(1)}\nevent: reset\ndata: {"reason":"overflow","state":"${token(1)}"}`,
    );
    expect(text).not.toContain('event: end');
    expect(text).not.toContain('never');
    expect(text.trimEnd().endsWith('}')).toBe(true);
  });

  test.each(['resync', 'expired'] as const)(
    'a reset %s has no id line and no end',
    async (reason) => {
      const made = started([{ control: 'reset', reason }]);
      const text = await (await made.open()).text();
      expect(text).toContain(`event: reset\ndata: {"reason":"${reason}"}\n\n`);
      expect(text).not.toContain('id:');
      expect(text).not.toContain('event: end');
    },
  );

  test('a reconnect with the reset id resumes there and gets every later change, then head', async () => {
    const seen: (StateToken | undefined)[] = [];
    const made = streamHost((invocation, resume) => {
      seen.push(resume?.after);
      return (async function* () {
        if (resume === undefined) {
          yield { event: 'one', state: token(1) };
          yield { control: 'reset', reason: 'overflow', state: token(1) } as const;
          return;
        }
        yield { event: 'two', state: token(2) };
        yield { event: 'three', state: token(3) };
        yield { control: 'head', state: token(3) } as const;
        // A live subscription waits for the next change.
        await new Promise<void>((resolve) =>
          invocation.signal?.addEventListener('abort', () => resolve()),
        );
      })();
    });
    hosts.push(made);
    const first = await (await made.open()).text();
    const lastId = /id: (v2\.\S+)\nevent: reset/.exec(first)?.[1];
    expect(lastId).toBe(token(1));
    const second = readEventStream(await made.open('', { 'last-event-id': lastId ?? '' }));
    const frames = await second.until((frame) => frame.event === 'head');
    await second.close();
    expect(seen).toEqual([undefined, token(1)]);
    expect(frames.map((frame) => frame.event)).toEqual(['welcome', 'data', 'data', 'head']);
  });
});
