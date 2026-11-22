import { vi } from 'vitest';

/** How a socket was closed. */
type Closed = { code: number | undefined; reason: string | undefined };

/** One message tRPC's connection handler sent over the fake socket, parsed. */
export type SocketMessage = Readonly<Record<string, unknown>>;

/** A web socket the handler can drive: what it sends and how it was closed are recorded. */
export class FakeTrpcSocket extends EventTarget {
  readonly protocol = 'keelwerk.trpc.v1';
  readyState = 1;
  readonly sent: (SocketMessage | 'PONG')[] = [];
  closedWith: Closed | undefined;
  /** Settles with the code and reason of the first close; a case awaits it instead of polling `closedWith`. */
  readonly closed: Promise<Closed>;
  readonly #settleClosed: (closed: Closed) => void;

  readonly url: string;

  constructor(url = 'wss://portal.example/trpc') {
    super();
    this.url = url;
    const closed = Promise.withResolvers<Closed>();
    this.closed = closed.promise;
    this.#settleClosed = closed.resolve;
  }

  send(data: string): void {
    this.sent.push(data === 'PONG' ? 'PONG' : (JSON.parse(data) as SocketMessage));
  }

  close(code?: number, reason?: string): void {
    if (this.closedWith !== undefined) return;
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.#settleClosed(this.closedWith);
    this.dispatchEvent(new CloseEvent('close', { code: code ?? 1000, reason: reason ?? '' }));
  }

  /** A text message from the client. */
  message(text: string): void {
    this.dispatchEvent(new MessageEvent('message', { data: text }));
  }

  /** The messages sent for `id`, in order, once `count` of them are there. */
  async sentFor(id: string | number, count = 1): Promise<SocketMessage[]> {
    return vi.waitFor(
      () => {
        const found = this.sent.filter(
          (message): message is SocketMessage => message !== 'PONG' && message.id === id,
        );
        if (found.length < count) {
          throw new Error(`Fewer than ${count} messages for ${id}: ${JSON.stringify(this.sent)}.`);
        }
        return found;
      },
      { timeout: 5_000, interval: 5 },
    );
  }

  /** The error message sent for `id`. */
  async errorFor(id: string | number): Promise<SocketMessage> {
    return vi.waitFor(
      () => {
        const found = this.sent.find(
          (message): message is SocketMessage =>
            message !== 'PONG' && message.id === id && message.error !== undefined,
        );
        if (found === undefined)
          throw new Error(`No error for ${id}: ${JSON.stringify(this.sent)}.`);
        return found;
      },
      { timeout: 5_000, interval: 5 },
    );
  }

  /** Waits until a message `PONG` was sent. */
  async pong(): Promise<void> {
    await vi.waitFor(
      () => {
        if (!this.sent.includes('PONG')) throw new Error('No PONG was sent.');
      },
      { timeout: 5_000, interval: 5 },
    );
  }
}
