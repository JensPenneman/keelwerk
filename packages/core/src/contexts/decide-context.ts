import type { Id } from '../ids/id.ts';
import type { RequestInfo } from '../invoker/request-info.ts';
import type { Clock } from '../kernel/clock.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { ConfigOf } from '../model/config-of.ts';
import type { EntityNameOf, OwnEntityValue } from '../model/entity-name-of.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { PrincipalOf } from '../principals/principal-of.ts';
import type { AllRequest } from '../protocol/all-request.ts';
import type { AskRequest } from '../protocol/ask-request.ts';
import type { FlagRequest } from '../protocol/flag-request.ts';
import type { IdRequest } from '../protocol/id-request.ts';
import type { RandomRequest } from '../protocol/random-request.ts';
import type { Request } from '../protocol/request.ts';
import type { Scope } from '../storage/scope.ts';
import type { Ability } from './ability.ts';
import type { AnswersOf } from './answers-of.ts';
import type { CoreComputations } from './core-computations.ts';
import type { EventDraftsOf } from './event-drafts-of.ts';
import type { ExtensionsOf } from './extensions-of.ts';
import type { FlagRequestsOf } from './flag-requests-of.ts';
import type { FlagResolution } from './flag-resolution.ts';
import type { LoadsOf } from './loads-of.ts';
import type { PrincipalRefOf } from './principal-ref-of.ts';
import type { SecretRequests } from './secret-requests.ts';
import type { ServicesOf } from './services-of.ts';
import type { WritesOf } from './writes-of.ts';

/**
 * The context of `decide`, `prepare`, `react`, services and fills (section 7.9.7), computed from
 * the base `B` alone; `W` are the modules and contracts that count as required inside a
 * contribution or conditional part, `P` the value `prepare` passed, `Pk` the admitted principal
 * kinds and `E` the target entity of an entity-mounted command.
 */
export interface DecideContext<
  B extends AnyModuleBase,
  W = readonly [],
  P = undefined,
  Pk extends PrincipalKind = PrincipalKind,
  E extends string = never,
> {
  readonly scope: Scope;
  readonly principal: PrincipalOf<Pk, PrincipalRefOf<B>>;
  readonly ability: Ability;
  readonly config: ConfigOf<B>;
  /** The invocation's clock: one instant, taken when execution begins (section 7.9.3). */
  readonly clock: Clock;
  /** Request metadata; credentials stay inside the principal resolvers. */
  readonly request: RequestInfo;
  readonly prepared: P;
  readonly load: LoadsOf<B, W>;
  readonly write: WritesOf<B, W>;
  readonly events: EventDraftsOf<B, E>;
  readonly flags: FlagRequestsOf<B, W>;
  flagDetails(key: string): FlagRequest<FlagResolution>;
  readonly services: ServicesOf<B, W>;
  readonly extensions: ExtensionsOf<B>;
  readonly secrets: SecretRequests;
  readonly compute: CoreComputations;
  newId<const En extends OwnEntityValue<B>>(
    entity: En,
  ): IdRequest<Id<`${B['id']}.${EntityNameOf<B, En>}`>>;
  random(bytes: number): RandomRequest;
  ask(ref: string, input: unknown): AskRequest;
  all<const T extends readonly Request<unknown>[]>(requests: T): AllRequest<AnswersOf<T>>;
  readonly log: Logger;
  readonly trace: Span;
}
