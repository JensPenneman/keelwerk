/** What a subscribe request asks for, validated for shape only: the input stays opaque until it is decoded against the surface. */
export interface SubscribeRequest {
  readonly action: string;
  readonly input: unknown;
  /** The token to resume after: a validated `Last-Event-ID` or `after`. */
  readonly after?: string;
}
