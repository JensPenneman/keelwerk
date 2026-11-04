import type { RequestInfo } from '../invoker/request-info.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { ConfigOf } from '../model/config-of.ts';
import type { Logger } from '../observability/logger.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { PrincipalOf } from '../principals/principal-of.ts';
import type { Scope } from '../storage/scope.ts';
import type { Ability } from './ability.ts';
import type { FlagRequests } from './flag-requests.ts';
import type { LiveOf } from './live-of.ts';

/** The context of a subscription's `source` (section 7.6). */
export interface SourceContext<
  B extends AnyModuleBase,
  W = readonly [],
  Pk extends PrincipalKind = PrincipalKind,
  T = never,
> {
  readonly scope: Scope;
  readonly principal: PrincipalOf<Pk>;
  readonly ability: Ability;
  readonly config: ConfigOf<B>;
  readonly request: RequestInfo;
  readonly flags: FlagRequests;
  readonly live: LiveOf<B, W>;
  readonly target: T;
  readonly log: Logger;
}
