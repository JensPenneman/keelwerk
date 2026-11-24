import type { ServerSentEvent } from './server-sent-event.ts';

/** The first line end of `text`: its index and length (a CR LF pair is one end), or undefined while it may still be incomplete. */
function lineEndOf(
  text: string,
  complete: boolean,
): { readonly at: number; readonly length: number } | undefined {
  const at = text.search(/[\r\n]/);
  if (at === -1) return undefined;
  if (text[at] === '\r') {
    // A CR at the very end may be the first half of a CR LF whose LF has not arrived.
    if (at === text.length - 1) return complete ? { at, length: 1 } : undefined;
    return { at, length: text[at + 1] === '\n' ? 2 : 1 };
  }
  return { at, length: 1 };
}

/**
 * The events of an SSE body in order: LF, CR and CRLF line ends, chunk boundaries and a leading
 * BOM are handled; comments, `retry` and blocks without data are skipped. The iteration ends with
 * the body, `return()` cancels it and it rejects when the body errors.
 */
export function parseEventStream(body: ReadableStream<Uint8Array>): AsyncIterable<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const ready: ServerSentEvent[] = [];
  let buffer = '';
  let finished = false;
  let event = '';
  let data: string[] = [];
  let id: string | undefined;

  const dispatch = (): void => {
    if (data.length > 0) {
      ready.push({
        event: event === '' ? 'message' : event,
        data: data.join('\n'),
        ...(id !== undefined && { id }),
      });
    }
    event = '';
    data = [];
    id = undefined;
  };
  const accept = (line: string): void => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
  };
  const drain = (): void => {
    for (
      let end = lineEndOf(buffer, finished);
      end !== undefined;
      end = lineEndOf(buffer, finished)
    ) {
      const line = buffer.slice(0, end.at);
      buffer = buffer.slice(end.at + end.length);
      accept(line);
    }
  };

  const iterator: AsyncIterator<ServerSentEvent> = {
    async next() {
      for (;;) {
        const next = ready.shift();
        if (next !== undefined) return { done: false, value: next };
        if (finished) return { done: true, value: undefined };
        const chunk = await reader.read();
        if (chunk.done) {
          finished = true;
          buffer += decoder.decode();
        } else {
          buffer += decoder.decode(chunk.value, { stream: true });
        }
        drain();
      }
    },
    async return() {
      finished = true;
      ready.length = 0;
      await reader.cancel().catch(() => undefined);
      return { done: true, value: undefined };
    },
  };
  return { [Symbol.asyncIterator]: () => iterator };
}
