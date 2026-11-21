/** The members of a `ws` socket that tRPC's connection handler reads. */
export interface TrpcWsClient {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): void;
  on(event: 'error', listener: (cause: unknown) => void): void;
  once(event: 'close', listener: () => void): void;
}

/** The host's web socket seen as tRPC's `ws` client, with the messages held until tRPC listens. */
export interface TrpcWsBridge {
  readonly client: TrpcWsClient;
  /** The first text message, taken before tRPC reads any; undefined when the socket closed first. */
  first(): Promise<string | undefined>;
  /** From now on tRPC's listeners get every message, those queued meanwhile first, in order. */
  attach(): void;
}
