import type { OpenLiveSocket } from './open-live-socket.ts';

const connecting = 0;
const opened = 1;
const closing = 2;
const closed = 3;
const maxReasonBytes = 123;

/**
 * The web `WebSocket` over a socket the host accepted (16.3.3): `readyState` is OPEN until the socket
 * is gone; `message` events carry the text messages in order (reading starts with the first `message`
 * listener, so none is lost to a handler that is not set up yet); one `close` event follows the last
 * message, with the close code (1006 without a close frame). `send` takes text only. `close` takes
 * 1000, 1011 (an internal failure) or 3000 to 4999 and a reason of at most 123 bytes, and closes through the host.
 */
class HostWebSocket extends EventTarget implements WebSocket {
  static readonly CONNECTING = connecting;
  static readonly OPEN = opened;
  static readonly CLOSING = closing;
  static readonly CLOSED = closed;
  // biome-ignore lint/style/useNamingConvention: the name is the web WebSocket's constant
  readonly CONNECTING: 0 = connecting;
  // biome-ignore lint/style/useNamingConvention: the name is the web WebSocket's constant
  readonly OPEN: 1 = opened;
  // biome-ignore lint/style/useNamingConvention: the name is the web WebSocket's constant
  readonly CLOSING: 2 = closing;
  // biome-ignore lint/style/useNamingConvention: the name is the web WebSocket's constant
  readonly CLOSED: 3 = closed;
  binaryType: 'blob' | 'arraybuffer' = 'blob';
  readonly bufferedAmount: number = 0;
  readonly extensions: string = '';
  readonly protocol: string;
  readonly url: string;
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
  #state: number = opened;
  #reading = false;
  readonly #socket: OpenLiveSocket;

  constructor(socket: OpenLiveSocket, protocol: string, url: string) {
    super();
    this.#socket = socket;
    this.protocol = protocol;
    this.url = url;
    void socket.closed.then(async () => {
      await this.#reader;
      this.#state = closed;
      const code = socket.closeCode() ?? 1006;
      const event = new CloseEvent('close', { code, reason: '', wasClean: code !== 1006 });
      this.onclose?.call(this, event);
      this.dispatchEvent(event);
    });
  }

  #reader: Promise<void> = Promise.resolve();

  get readyState(): number {
    return this.#state;
  }

  override addEventListener(
    type: string,
    callback: EventListener | EventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback, options);
    if (type === 'message') this.#read();
  }

  #read(): void {
    if (this.#reading) return;
    this.#reading = true;
    this.#reader = (async () => {
      for await (const text of this.#socket.connection.receive()) {
        const event = new MessageEvent('message', { data: text });
        this.onmessage?.call(this, event);
        this.dispatchEvent(event);
      }
    })().catch(() => undefined);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data !== 'string') {
      throw new TypeError('This socket carries text messages only.');
    }
    if (this.#state !== opened) return;
    this.#socket.connection.send(data).catch(() => undefined);
  }

  close(code?: number, reason?: string): void {
    if (code !== undefined && code !== 1000 && code !== 1011 && (code < 3000 || code > 4999)) {
      throw new DOMException(
        'The close code must be 1000, 1011 or 3000 to 4999.',
        'InvalidAccessError',
      );
    }
    if (reason !== undefined && Buffer.byteLength(reason) > maxReasonBytes) {
      throw new DOMException('The close reason is longer than 123 bytes.', 'SyntaxError');
    }
    if (this.#state === opened) this.#state = closing;
    this.#socket.closeWith(code ?? 1000, reason ?? '');
  }
}

/** The web `WebSocket` over an accepted socket, as `protocol` was negotiated for `url`. */
export function webSocketOf(open: OpenLiveSocket, protocol: string, url: string): WebSocket {
  return new HostWebSocket(open, protocol, url);
}
