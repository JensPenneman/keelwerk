import type { LiveServerMessage } from '@keelwerk/core';
import { liveMessageUntil } from './live-message-until.ts';
import type { SocketDialect } from './socket-dialect.ts';

/** `keelwerk.live.v1` (15.4.7): `hello` and `welcome`, `subscribe` answered by `head` or `error`. */
export const liveSocketDialect: SocketDialect = {
  protocol: 'keelwerk.live.v1',
  path: '/_keelwerk/v1/live',
  async open(socket) {
    socket.send(JSON.stringify({ type: 'hello' }));
    await liveMessageUntil(socket, (message) => message.type === 'welcome');
  },
  async subscribe(socket, id) {
    socket.send(JSON.stringify({ type: 'subscribe', id, action: 'loans.loanTicker', input: {} }));
    const answer: LiveServerMessage = await liveMessageUntil(
      socket,
      (message) => 'id' in message && message.id === id,
    );
    if (answer.type === 'head') return { kind: 'head' };
    if (answer.type === 'error') return { kind: 'refused', code: answer.error.code };
    return { kind: 'other', frame: JSON.stringify(answer) };
  },
};
