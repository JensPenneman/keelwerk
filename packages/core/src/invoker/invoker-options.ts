import type { RowEnvironment } from '../authorization/row-environment.ts';
import type { CarrierEnricher } from '../edge/carrier-enricher.ts';
import type { TenantResolver } from '../edge/tenant-resolver.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { Logger } from '../observability/logger.ts';
import type { Tracer } from '../observability/tracer.ts';
import type { OperatorPrincipal } from '../principals/operator-principal.ts';
import type { Scope } from '../storage/scope.ts';
import type { CommandRunner } from './command-runner.ts';
import type { InvokerApp } from './invoker-app.ts';
import type { PlacementHandle } from './placement-handle.ts';
import type { ScopeLookup } from './scope-lookup.ts';
import type { ScopeTarget } from './scope-target.ts';

/** What `createInvoker` is built from. The runtime (WP-43) and the test harness (WP-39) supply it. */
export interface InvokerOptions {
  /** The apps this process serves, by app id; 'core' serves deployment-level actions. */
  readonly apps: ReadonlyMap<string, InvokerApp>;
  readonly directory: ScopeLookup;
  /** The connected placement of an id; undefined for one this process does not hold. */
  readonly placement: (placementId: string) => PlacementHandle | undefined;
  /** The control store, where deployment-scope actions run. */
  readonly control?: ScopeTarget;
  /** Deployment order; default `[{ kind: 'hostname' }]`. 'scopeKey' and 'path' are refused at creation (S-20). */
  readonly tenantResolution?: readonly TenantResolver[];
  /** Sets `carrier.scopeKey`; accepted so a deployment can be wired once, unused until the scope directory exists (S-20). */
  readonly carrierEnrichers?: readonly CarrierEnricher[];
  readonly clock: Clock;
  readonly keys: KeyService;
  readonly compute: ComputePool;
  readonly log: Logger;
  /** Default: the global no-op tracer. */
  readonly tracer?: Tracer;
  /** Decides how a row outside the plan and an undeclared exception are handled. */
  readonly environment: RowEnvironment;
  /** The build recorded on jobs the invoker enqueues; default `{ id: 'development', revision: 1 }`. */
  readonly build?: { readonly id: string; readonly revision: number };
  /** The epoch of a scope, part of every state token (section 15.2.6); default: 0 for every scope. */
  readonly epochOf?: (scope: Scope) => number;
  /** Resolves a presented operator token (section 3.5); throws `unauthenticated` for one it does not accept. Without it tokens are not recognised. */
  readonly operatorTokens?: (token: string) => Promise<OperatorPrincipal>;
  /** The operator host names (`operator.hosts` of the deployment); an operator token is honoured at these hosts only (sections 3.5 and 8.8). */
  readonly operatorHosts?: readonly string[];
  /** The command write path (WP-38); without it a command is `not_implemented`. */
  readonly commands?: CommandRunner;
}
