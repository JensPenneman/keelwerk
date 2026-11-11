import { errors } from '../errors/errors.ts';

/** A line break or NUL: in a name or an id it would end the field and start a frame of the caller's making. */
const lineBreak = /[\r\n\0]/;

function checked(what: string, text: string): string {
  if (lineBreak.test(text)) {
    throw errors.internal(`The ${what} of a server-sent event holds a line break or a NUL.`);
  }
  return text;
}

/**
 * One server-sent event: `id: <id>` when `id` is a string (`id:` alone when it is null: the client
 * forgets its last event id), `event: <name>`, one `data:` line of `JSON.stringify(data)`, and a
 * blank line. JSON holds no raw line break, so one `data:` line always carries the whole value. A
 * name or an id with CR, LF or NUL is an internal error: no caller can inject a frame through them.
 */
export function sseEventOf(name: string, data: unknown, id?: string | null): string {
  const idLine = id === undefined ? '' : id === null ? 'id:\n' : `id: ${checked('id', id)}\n`;
  return `${idLine}event: ${checked('name', name)}\ndata: ${JSON.stringify(data)}\n\n`;
}
