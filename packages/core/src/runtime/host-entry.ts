import type { CarrierEnricher } from '../edge/carrier-enricher.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Logger } from '../observability/logger.ts';
import type { Telemetry } from '../observability/telemetry.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { TransportHost } from '../transport/transport-host.ts';

/** What the runtime hands the HTTP host when it builds it (section 16.3.3). */
interface HostDeps {
  readonly invoker: Invoker;
  surface(appId: string, version?: string): ApiSurface;
  readonly telemetry: Telemetry;
  readonly log: Logger;
  readonly operator?: { readonly socket?: string; readonly fallbackDirectory?: string };
  readonly enrichers?: readonly CarrierEnricher[];
  allowedOrigins?(session: InvocationSession, transport?: string): readonly string[];
  ready?(): Promise<boolean>;
  readonly development?: boolean;
}

/** The running host: the transports' `TransportHost` plus the lifecycle the runtime drives. */
export interface HostInstance extends TransportHost {
  /** Opens the configured listeners. */
  listen(): Promise<unknown>;
  stop(deadlineMs: number): Promise<void>;
}

/** An infrastructure entry that builds the HTTP host once the runtime has its invoker (`httpHost()` of `@keelwerk/transport-http`). */
export interface HostEntry {
  readonly kind: 'httpHost';
  create(deps: HostDeps): HostInstance;
}
