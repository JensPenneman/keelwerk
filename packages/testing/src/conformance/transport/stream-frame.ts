/** One event of a server-sent event stream: its name, its id (`''` when the stream cleared it) and its parsed data. */
export interface StreamFrame {
  readonly event: string;
  readonly id: string | undefined;
  readonly data: unknown;
}
