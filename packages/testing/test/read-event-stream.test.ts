import { describe, expect, test } from 'vitest';
import { readEventStream } from '../src/conformance/transport/read-event-stream.ts';

const framesOf = async (text: string): Promise<readonly unknown[]> => {
  const reader = readEventStream(
    new Response(text, { headers: { 'content-type': 'text/event-stream' } }),
  );
  try {
    return await reader.until(() => false, 1000);
  } finally {
    await reader.close();
  }
};

describe('readEventStream', () => {
  test('a block with data and no event line is a message', async () => {
    expect(await framesOf('id: s1\ndata: {"a":1}\n\ndata: 2\n\n')).toEqual([
      { event: 'message', id: 's1', data: { a: 1 } },
      { event: 'message', id: undefined, data: 2 },
    ]);
  });

  test('a block with no data and no event (comment, keep-alive, id alone) is skipped', async () => {
    expect(await framesOf(': keep-alive\n\nid: s1\n\n: note\nid: s2\n\n')).toEqual([]);
  });

  test('a block with empty data lines and no event line dispatches nothing', async () => {
    expect(await framesOf('data:\n\nid: x\ndata:\n\ndata:\ndata:\n\ndata: 3\n\n')).toEqual([
      { event: 'message', id: undefined, data: 3 },
    ]);
  });

  test('a named event keeps its name, and an event with only empty data lines carries no data', async () => {
    expect(await framesOf('event: next\ndata: {"b":2}\n\nevent: complete\ndata:\n\n')).toEqual([
      { event: 'next', id: undefined, data: { b: 2 } },
      { event: 'complete', id: undefined, data: undefined },
    ]);
  });
});
