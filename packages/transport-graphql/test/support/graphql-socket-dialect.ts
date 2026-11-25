import type { SocketDialect, SocketSubscribeAnswer, TestSocket } from '@keelwerk/testing';
import { tickerQuery, titlesQuery } from './graphql-ws-client.ts';

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

async function subscribeTo(
  socket: TestSocket,
  id: string,
  query: string,
): Promise<SocketSubscribeAnswer> {
  socket.send(JSON.stringify({ id, type: 'subscribe', payload: { query } }));
  const answer = JSON.parse(String(await socket.next())) as Frame;
  if (answer.id !== id) return { kind: 'other', frame: JSON.stringify(answer) };
  if (answer.type === 'next') return { kind: 'head' };
  if (answer.type === 'error') return { kind: 'refused', code: codeOf(answer.payload) };
  return { kind: 'other', frame: JSON.stringify(answer) };
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
  subscribe: (socket, id) => subscribeTo(socket, id, tickerQuery),
  subscribeTitles: (socket, id) => subscribeTo(socket, id, titlesQuery),
  async frame(socket, id, ms) {
    for (;;) {
      const message = JSON.parse(String(await socket.next(ms))) as Frame;
      if (message.id !== id) continue;
      if (message.type === 'complete') return { kind: 'end' };
      if (message.type === 'error') return { kind: 'error', code: codeOf(message.payload) };
      if (message.type !== 'next') {
        throw new Error(`Unexpected graphql-transport-ws message ${JSON.stringify(message)}.`);
      }
      const data = (message.payload as { data?: Record<string, unknown> } | undefined)?.data;
      const member = data?.loansLoanTitles;
      if (typeof member !== 'object' || member === null) {
        throw new Error(
          `A next message without the subscription's member: ${JSON.stringify(message)}.`,
        );
      }
      const { __typename: typename, state: _state, ...event } = member as Record<string, unknown>;
      if (typename === 'StreamHead') return { kind: 'control', control: 'head' };
      if (typename === 'StreamReset') return { kind: 'control', control: 'reset' };
      if (typename === 'StreamGap') return { kind: 'control', control: 'gap' };
      return { kind: 'item', event };
    }
  },
};
