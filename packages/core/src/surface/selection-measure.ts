/** One selected leaf with the entity references above it, root first. */
export interface SelectionPath {
  readonly entities: readonly string[];
  readonly field: string;
}

/** What a transport counts while it parses a request (the GraphQL transport, F-26). */
export interface SelectionMeasure {
  readonly paths: readonly SelectionPath[];
  readonly aliases: number;
  readonly operations: number;
  /** Wire-format tokens of the selection part. */
  readonly tokens: number;
  /** Selected connection (list page) fields. */
  readonly connectionPages: number;
}
