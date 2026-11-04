import type { EntityAt, EventsOf } from './base-members.ts';
import type { ConfigOf } from './config-of.ts';
import type { Draft } from './decision.ts';
import type { AnyModuleBase } from './define-module-base.ts';
import type { ExtensionPoint } from './extension-point.ts';
import type { Id, SecretRef } from './id.ts';
import type { LoadsOf } from './loads-of.ts';
import type { EntityNameOf, OwnEntityValue } from './module-rows.ts';
import type { PrincipalKind, PrincipalOf } from './principal.ts';
import type { Request } from './request.ts';
import type { ServicesOf } from './services-of.ts';
import type { Shape } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';
import type { WritesOf } from './writes-of.ts';

type ExtensionPointsOf<B> = B extends { readonly extensionPoints: infer X } ? X : {};

/** The scope an invocation runs in. */
export interface Scope {
  readonly kind: 'tenant' | 'backend' | 'deployment';
  readonly backend: string | null;
  readonly tenant: string | null;
}

/** Pure questions over the rules: may the principal do this? */
export interface Ability {
  can(action: string): boolean;
}

/** The invocation's clock: one instant, taken when execution begins (section 7.9.3). */
export interface Clock {
  now(): Temporal.Instant;
}

/** Request metadata; credentials stay inside the principal resolvers. */
export interface RequestInfo {
  readonly transport: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Write-only logging, the one capability a pure handler has (section 7.9.7). */
export interface Logger {
  debug(data: object, message: string): void;
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
}

/** Write-only tracing. */
export interface Span {
  setAttribute(name: string, value: string | number | boolean): void;
}

/** The resolution of one flag, with its reason (section 20.3). */
export interface FlagResolution {
  readonly value: boolean | string;
  readonly reason: string;
}

/** Flag requests per module and flag; the spike types them without the flag model. */
export interface FlagRequests {
  readonly [module: string]: { readonly [flag: string]: Request<boolean | string> };
}

/** A secret issued by the key service: the plaintext once, the public id and the verifier to store. */
export interface IssuedSecret {
  readonly plain: string;
  readonly publicId: string;
  readonly verifier: string;
}

/** Secret requests (section 7.9.3). */
export interface SecretRequests {
  issue(options: { readonly prefix: string }): Request<IssuedSecret>;
  reveal(ref: SecretRef, reason: string): Request<string>;
  verify(token: string, verifier: string): Request<boolean>;
}

/** Computations of the core, answered off the event loop. */
export interface CoreComputations {
  argon2idHash(password: string, salt: Uint8Array): Request<string>;
  argon2idVerify(verifier: string, password: string): Request<boolean>;
}

/** The answers of `ctx.all`, a tuple for a tuple of requests. */
export type AnswersOf<T extends readonly Request<unknown>[]> = {
  -readonly [K in keyof T]: T[K] extends Request<infer A> ? A : never;
};

/** `ctx.events`: the target entity's domain events, for entity-mounted commands. */
export type EventDraftsOf<B, E extends string> = [E] extends [never]
  ? {}
  : {
      readonly [K in keyof EventsOf<EntityAt<B, E>>]: (
        payload: EventsOf<EntityAt<B, E>>[K] extends Shape<infer F>
          ? ShapeValue<F, B extends { readonly id: infer I extends string } ? I : string, 'draft'>
          : never,
      ) => Draft;
    };

/** `ctx.extensions`: the values filled into the module's own extension points. */
export type ExtensionsOf<B> = {
  readonly [K in keyof ExtensionPointsOf<B>]: ExtensionPointsOf<B>[K] extends ExtensionPoint<
    infer T
  >
    ? readonly T[]
    : never;
};

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
  readonly principal: PrincipalOf<Pk>;
  readonly ability: Ability;
  readonly config: ConfigOf<B>;
  readonly clock: Clock;
  readonly request: RequestInfo;
  readonly prepared: P;
  readonly load: LoadsOf<B, W>;
  readonly write: WritesOf<B, W>;
  readonly events: EventDraftsOf<B, E>;
  readonly flags: FlagRequests;
  flagDetails(key: string): Request<FlagResolution>;
  readonly services: ServicesOf<B, W>;
  readonly extensions: ExtensionsOf<B>;
  readonly secrets: SecretRequests;
  readonly compute: CoreComputations;
  newId<const En extends OwnEntityValue<B>>(
    entity: En,
  ): Request<Id<`${B['id']}.${EntityNameOf<B, En>}`>>;
  random(bytes: number): Request<Uint8Array>;
  ask(ref: string, input: unknown): Request<unknown>;
  all<const T extends readonly Request<unknown>[]>(requests: T): Request<AnswersOf<T>>;
  readonly log: Logger;
  readonly trace: Span;
}
