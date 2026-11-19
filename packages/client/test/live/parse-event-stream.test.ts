import { describe, expect, it } from 'vitest';
import { parseEventStream } from '../../src/sse/parse-event-stream.ts';

const encoder = new TextEncoder();

function bodyOf(chunks: readonly (string | Uint8Array)[]): {
  body: ReadableStream<Uint8Array>;
  cancelled: () => boolean;
} {
  let cancelled = false;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, cancelled: () => cancelled };
}

async function eventsOf(chunks: readonly (string | Uint8Array)[]) {
  const events = [];
  for await (const event of parseEventStream(bodyOf(chunks).body)) events.push(event);
  return events;
}

describe('parseEventStream', () => {
  it('reads blocks with an event name, an id and data, and defaults the name to message', async () => {
    expect(await eventsOf(['id: v2.1\nevent: data\ndata: {"a":1}\n\n', 'data: plain\n\n'])).toEqual(
      [
        { event: 'data', data: '{"a":1}', id: 'v2.1' },
        { event: 'message', data: 'plain' },
      ],
    );
  });

  it('joins data lines with a line feed and removes one leading space only', async () => {
    expect(await eventsOf(['data:  two spaces\ndata:\ndata: last\n\n'])).toEqual([
      { event: 'message', data: ' two spaces\n\nlast' },
    ]);
  });

  it('handles LF, CR and CRLF line ends, also split between chunks', async () => {
    expect(await eventsOf(['event: a\r\ndata: 1\r\n\r\n', 'event: b\rdata: 2\r\r'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
    expect(await eventsOf(['event: a\r', '\ndata: 1\r', '\n\r', '\n', 'data: 2\n\n'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'message', data: '2' },
    ]);
  });

  it('handles a block cut at every byte, a multibyte character included', async () => {
    const bytes = encoder.encode('id: 7\nevent: data\ndata: café ☃\n\n');
    const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
    expect(await eventsOf(chunks)).toEqual([{ event: 'data', data: 'café ☃', id: '7' }]);
  });

  it('skips a leading byte order mark, comments, retry and blocks without data', async () => {
    expect(
      await eventsOf([
        '\uFEFFretry: 3000\n\n',
        ': ping\n\n',
        'event: empty\n\n',
        'id: 4\n\n',
        'data: kept\n\n',
      ]),
    ).toEqual([{ event: 'message', data: 'kept' }]);
  });

  it('keeps a bare id as the empty string and drops an id with a NUL', async () => {
    expect(await eventsOf(['id:\ndata: a\n\n', 'id: x\0y\ndata: b\n\n'])).toEqual([
      { event: 'message', data: 'a', id: '' },
      { event: 'message', data: 'b' },
    ]);
  });

  it('does not repeat an id on the next block', async () => {
    const events = await eventsOf(['id: 1\ndata: a\n\ndata: b\n\n']);
    expect(events[1]).toEqual({ event: 'message', data: 'b' });
  });

  it('drops a block the body ended in the middle of', async () => {
    expect(await eventsOf(['data: whole\n\ndata: cut'])).toEqual([
      { event: 'message', data: 'whole' },
    ]);
  });

  it('return cancels the body, and a body that errors rejects the iteration', async () => {
    const opened = bodyOf(['data: a\n\n', 'data: b\n\n']);
    const iterator = parseEventStream(opened.body)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ event: 'message', data: 'a' });
    await iterator.return?.();
    expect(opened.cancelled()).toBe(true);
    expect((await iterator.next()).done).toBe(true);
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('cut'));
      },
    });
    await expect(parseEventStream(broken)[Symbol.asyncIterator]().next()).rejects.toThrow('cut');
  });
});
