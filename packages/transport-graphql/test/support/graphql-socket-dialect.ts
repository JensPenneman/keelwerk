import type { SocketDialect } from '@keelwerk/testing';
import { tickerQuery } from './graphql-ws-client.ts';

interface Frame {
  readonly type?: string;
  readonly id?: string;
  readonly payload?: unknown;
}

function codeOf(payload: unknown): string {
  const first: unknown = Array.isArray(payload) ? payload[0] : undefined;
  const extensions: unknown =
    typeof first === 'object' && first !== null ? Reflect.get(first, 'extensions') : undefined;
  const keelwerk: unknown =
    typeof extensions === 'object' && extensions !== null
      ? Reflect.get(extensions, 'keelwerk')
      : undefined;
  const code: unknown =
    typeof keelwerk === 'object' && keelwerk !== null ? Reflect.get(keelwerk, 'code') : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

/** graphql-transport-ws on `/graphql`: `connection_init` and its acknowledgement; a subscription to the public ticker answers `next` (its head) or `error`. */
export const graphqlSocketDialect: SocketDialect = {
  protocol: 'graphql-transport-ws',
  path: '/graphql',
  async open(socket) {
    socket.send(JSON.stringify({ type: 'connection_init' }));
    const answer = JSON.parse(String(await socket.next())) as Frame;
    if (answer.type !== 'connection_ack') {
      throw new Error(`Expected connection_ack, got ${JSON.stringify(answer)}.`);
    }
  },
  async subscribe(socket, id) {
    socket.send(JSON.stringify({ id, type: 'subscribe', payload: { query: tickerQuery } }));
    const answer = JSON.parse(String(await socket.next())) as Frame;
    if (answer.id !== id) return { kind: 'other', frame: JSON.stringify(answer) };
    if (answer.type === 'next') return { kind: 'head' };
    if (answer.type === 'error') return { kind: 'refused', code: codeOf(answer.payload) };
    return { kind: 'other', frame: JSON.stringify(answer) };
  },
};
