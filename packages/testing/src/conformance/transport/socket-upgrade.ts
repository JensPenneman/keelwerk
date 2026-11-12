import type { TestSocket } from './test-socket.ts';

/** What a WebSocket upgrade answered: the open socket after a 101, else the refusal as a response. */
export type SocketUpgrade =
  | {
      readonly kind: 'open';
      /** The subprotocol of the 101 (`Sec-WebSocket-Protocol`), or null. */
      readonly protocol: string | null;
      readonly headers: Headers;
      readonly socket: TestSocket;
    }
  | { readonly kind: 'refused'; readonly response: Response };
