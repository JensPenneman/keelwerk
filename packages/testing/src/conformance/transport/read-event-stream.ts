import type { EventStreamReader } from './event-stream-reader.ts';
import type { StreamFrame } from './stream-frame.ts';

const defaultMs = 10_000;

/** One block of the stream (the text between two blank lines) as a frame; comments and blocks with no event are skipped. */
function frameOf(block: string): StreamFrame | undefined {
  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const name = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (name === 'event') event = value;
    else if (name === 'id') id = value;
    else if (name === 'data') data.push(value);
  }
  if (event === undefined) return undefined;
  return { event, id, data: data.length === 0 ? undefined : JSON.parse(data.join('\n')) };
}

/**
 * Reads a server-sent event response as the events it carries. A body that is not an event stream
 * (an error answer) ends at once: `next` answers undefined, and `response` has the status and the body.
 */
export function readEventStream(response: Response): EventStreamReader {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  const take = (): StreamFrame | undefined | null => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end === -1) return done ? undefined : null;
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const frame = frameOf(block);
      if (frame !== undefined) return frame;
    }
  };
  const next = async (ms = defaultMs): Promise<StreamFrame | undefined> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const frame = take();
      if (frame !== null) return frame;
      if (reader === undefined) return undefined;
      const left = deadline - Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`The stream sent nothing for ${ms} ms.`)),
            Math.max(0, left),
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) done = true;
      else buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
  return {
    response,
    next,
    until: async (test, ms = defaultMs) => {
      const frames: StreamFrame[] = [];
      for (;;) {
        const frame = await next(ms);
        if (frame === undefined) return frames;
        frames.push(frame);
        if (test(frame)) return frames;
      }
    },
    close: async () => {
      await reader?.cancel().catch(() => undefined);
    },
  };
}
