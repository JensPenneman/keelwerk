/** What a queue implementation supports (section 9.5.1, S-156). */
export interface QueueCapabilities {
  readonly keys: boolean;
  readonly groups: boolean;
  readonly fifoPerKey: boolean;
  readonly heartbeat: boolean;
  readonly schedules: boolean;
  readonly fairLanes: boolean;
}
