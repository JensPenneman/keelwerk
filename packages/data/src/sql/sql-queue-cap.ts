/** The queued cap one enqueue of a unit asked the commit tail to check in its queue. */
export interface SqlQueueCap {
  readonly queue: string;
  readonly cap: number;
}
