import type {
  ApiSurface,
  CarrierEnricher,
  Clock,
  InvocationSession,
  Invoker,
  Logger,
  Telemetry,
} from '@keelwerk/core';

/** What the runtime hands the host when it builds it (wired by the runtime, section 3.3). */
export interface HttpHostDeps {
  readonly invoker: Invoker;
  /**
   * The surface of an app at an API version; default: the head. It throws `AppNotServedError` for an
   * app this process does not serve; any other throw is an internal failure.
   */
  surface(appId: string, version?: string): ApiSurface;
  readonly telemetry: Telemetry;
  readonly log: Logger;
  /** The operator socket of `defineDeployment({ operator })`; absent: no operator endpoint. */
  readonly operator?: {
    readonly socket?: string;
    /** The directory of the short fallback socket path; default: `<tmpdir>/keelwerk-<uid>`. */
    readonly fallbackDirectory?: string;
  };
  /** The deployment's carrier enrichers, run in order before the scope is resolved. */
  readonly enrichers?: readonly CarrierEnricher[];
  /** The tenant's domains plus the transport's `cors` setting, as origins (`https://host`). */
  allowedOrigins?(session: InvocationSession, transport?: string): readonly string[];
  /** Whether the control store, the placements and the queue answer; default: ready. */
  ready?(): Promise<boolean>;
  /** Development shows operators' detail to every caller (section 10). */
  readonly development?: boolean;
  /** The runtime's clock: the time of cookie lifetimes; absent: the system clock (change note, followups). */
  readonly clock?: Clock;
}
