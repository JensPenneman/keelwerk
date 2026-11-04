import type { ActionPart, AnyActionPart, PartTypes } from './action-part.ts';
import type { AnyErrorSpec } from './define-error.ts';
import type { EntityLoads } from './loads-of.ts';
import type { OwnRow } from './module-rows.ts';
import { mountName } from './mount-name.ts';
import type { EntityOutputSpec } from './page-of.ts';
import type {
  ActionOptions,
  EntityTargetOf,
  ErrorUnion,
  HandlerOutput,
  InputSpec,
  InputValue,
  NoOutput,
  OutputSpec,
  PageInput,
  TargetName,
  WireOutput,
} from './part-io.ts';
import type { BaseOf, OwnerOf, PartSource, WhenOf } from './part-source.ts';
import type { Prettify } from './prettify.ts';
import type { PrincipalKind } from './principal.ts';
import type { ReadContext } from './read-context.ts';
import type { Gen, Request } from './request.ts';
import type { Shape } from './shape.ts';

type ReadResult<O> = O | Request<O> | Gen<O>;
type QueryInput<In, Out, Owner extends string> =
  Out extends EntityOutputSpec<'page', unknown>
    ? Prettify<InputValue<In, Owner> & PageInput>
    : InputValue<In, Owner>;
type TargetLoads<S, T> = EntityLoads<
  OwnRow<BaseOf<S>, TargetName<S, T>, 'readable'>,
  OwnRow<BaseOf<S>, TargetName<S, T>, 'readable'>
>;

/** Options of queries. */
export interface QueryOptions<In, Out, Er extends readonly AnyErrorSpec[], Pk extends PrincipalKind>
  extends ActionOptions<In, Out, Er, Pk> {
  readonly page?: {
    readonly sortable?: readonly string[];
    readonly defaultSize?: number;
    readonly maxSize?: number;
  };
}

/** A module-level (or app-level) query literal. */
export interface ModuleQuerySpec<
  S,
  In,
  Out,
  Er extends readonly AnyErrorSpec[],
  Pk extends PrincipalKind,
> extends QueryOptions<In, Out, Er, Pk> {
  readonly read: (
    input: InputValue<In, OwnerOf<S>>,
    ctx: ReadContext<BaseOf<S>, WhenOf<S>, Pk>,
  ) => ReadResult<HandlerOutput<Out, S, void>>;
}

/** An entity-mounted query literal: `ctx.target` reads the entity through the action's own plan. */
export interface EntityQuerySpec<
  S,
  T,
  In,
  Out,
  Er extends readonly AnyErrorSpec[],
  Pk extends PrincipalKind,
> extends QueryOptions<In, Out, Er, Pk> {
  readonly read: (
    input: InputValue<In, OwnerOf<S>>,
    ctx: ReadContext<BaseOf<S>, WhenOf<S>, Pk, TargetLoads<S, T>>,
  ) => ReadResult<HandlerOutput<Out, S, void>>;
}

/** Defines a query (section 4.3). */
export function defineQuery<
  const S extends PartSource,
  const In extends InputSpec = Shape<{}>,
  const Out extends OutputSpec = NoOutput,
  const Er extends readonly AnyErrorSpec[] = readonly [],
  const Pk extends PrincipalKind = PrincipalKind,
>(
  source: S,
  spec: ModuleQuerySpec<S, In, Out, Er, Pk>,
): ActionPart<
  'query',
  S,
  null,
  'sync',
  PartTypes<QueryInput<In, Out, OwnerOf<S>>, WireOutput<Out, S, void>, ErrorUnion<Er>, never>
>;
export function defineQuery<
  const S extends PartSource,
  const T extends EntityTargetOf<S>,
  const In extends InputSpec = Shape<{}>,
  const Out extends OutputSpec = NoOutput,
  const Er extends readonly AnyErrorSpec[] = readonly [],
  const Pk extends PrincipalKind = PrincipalKind,
>(
  source: S,
  target: T,
  spec: EntityQuerySpec<S, T, In, Out, Er, Pk>,
): ActionPart<
  'query',
  S,
  TargetName<S, T>,
  'sync',
  PartTypes<QueryInput<In, Out, OwnerOf<S>>, WireOutput<Out, S, void>, ErrorUnion<Er>, never>
>;
export function defineQuery(
  source: object,
  targetOrSpec: unknown,
  maybeSpec?: object,
): AnyActionPart {
  return {
    kind: 'query',
    source,
    mount: maybeSpec === undefined ? null : mountName(source, targetOrSpec),
    execution: 'sync',
    spec: maybeSpec ?? (targetOrSpec as object),
  };
}
