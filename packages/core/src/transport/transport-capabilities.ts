export interface TransportCapabilities {
  readonly streaming: readonly ('sse' | 'websocket')[];
  /** Several invocations per request (GraphQL documents, tRPC batches). */
  readonly batching: boolean;
  /** Carries binary fields without base64. */
  readonly binary: boolean;
}
