import type { LiveServerMessage } from '@keelwerk/core';
import { liveMessageUntil } from './live-message-until.ts';
import type { SocketDialect } from './socket-dialect.ts';
import type { SocketSubscribeAnswer } from './socket-subscribe-answer.ts';
import type { TestSocket } from './test-socket.ts';

async function subscribeTo(
  socket: TestSocket,
  id: string,
  action: string,
): Promise<SocketSubscribeAnswer> {
  socket.send(JSON.stringify({ type: 'subscribe', id, action, input: {} }));
  const answer: LiveServerMessage = await liveMessageUntil(
    socket,
    (message) => 'id' in message && message.id === id,
  );
  if (answer.type === 'head') return { kind: 'head' };
  if (answer.type === 'error') return { kind: 'refused', code: answer.error.code };
  return { kind: 'other', frame: JSON.stringify(answer) };
}

/** `keelwerk.live.v1` (15.4.7): `hello` and `welcome`, `subscribe` answered by `head` or `error`. */
export const liveSocketDialect: SocketDialect = {
  protocol: 'keelwerk.live.v1',
  path: '/_keelwerk/v1/live',
  async open(socket) {
    socket.send(JSON.stringify({ type: 'hello' }));
    await liveMessageUntil(socket, (message) => message.type === 'welcome');
  },
  subscribe: (socket, id) => subscribeTo(socket, id, 'loans.loanTicker'),
  subscribeTitles: (socket, id) => subscribeTo(socket, id, 'loans.loanTitles'),
  async frame(socket, id, ms) {
    for (;;) {
      const message = JSON.parse(String(await socket.next(ms))) as LiveServerMessage;
      switch (message.type) {
        case 'data':
          if (message.id === id) return { kind: 'item', event: message.item };
          break;
        case 'head':
        case 'reset':
        case 'gap':
          if (message.id === id) return { kind: 'control', control: message.type };
          break;
        case 'end':
          if (message.id === id) return { kind: 'end', reason: message.reason };
          break;
        case 'error':
          if (message.id === id || message.id === undefined) {
            return { kind: 'error', code: message.error.code };
          }
          break;
        default:
          break;
      }
    }
  },
};
