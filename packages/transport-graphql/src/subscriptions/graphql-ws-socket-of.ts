import type { WebSocket as GraphqlWsSocket } from 'graphql-ws';

/** The close reason graphql-ws's protocol gives a code: a fixed text, never the client's id or any other client text, which the library puts in some of its own. */
const reasons: Readonly<Record<number, string>> = {
  4400: 'Invalid message received',
  4401: 'Unauthorized',
  4403: 'Forbidden',
  4406: 'Subprotocol not acceptable',
  4408: 'Connection initialisation timeout',
  4409: 'Subscriber already exists',
  4429: 'Too many initialisation requests',
  4500: 'Internal server error',
};

/**
 * graphql-ws's socket over the web one the host hands over: the subprotocol, `send`, `close` with a
 * fixed reason for each code of the protocol (the library's texts can carry what a client sent) and
 * `onMessage` over the `message` events, text only. A message the library's handler rejects for
 * closes the socket 4500.
 */
export function graphqlWsSocketOf(socket: WebSocket): GraphqlWsSocket {
  return {
    protocol: socket.protocol,
    send: (data) => {
      socket.send(data);
    },
    close: (code, reason) => {
      socket.close(code, code === undefined ? reason : (reasons[code] ?? reason));
    },
    onMessage: (handler) => {
      socket.addEventListener('message', (event) => {
        if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return;
        handler(event.data).catch(() => {
          socket.close(4500, reasons[4500]);
        });
      });
    },
  };
}
