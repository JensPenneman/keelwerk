/** A schedule a module declares (section 9.5.6): it enqueues an own command every `every` under the module's service principal. */
export interface ScheduleEntry {
  /** 'dns.refreshPublicAddressSchedule'. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  /** A duration such as '5m' or '1d'. */
  readonly every: string;
  /** The reference of the command it invokes. */
  readonly invoke: string;
  readonly scope: 'backend' | 'each-tenant';
  /** A duration such as '30s'. */
  readonly jitter?: string;
  /** Derives the command's input from the tick; pure. */
  input?(tick: unknown): unknown;
}
