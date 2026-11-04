import type { EntityLoads } from '../contexts/entity-loads.ts';
import type { ReadContext } from '../contexts/read-context.ts';
import type { AnyErrorDefinition } from '../errors/error-definition.ts';
import type { Shape } from '../fields/shape.ts';
import type { ActionOptions } from '../model/action-options.ts';
import type { ActionPart, AnyActionPart, PartTypes } from '../model/action-part.ts';
import type { EntityTargetOf } from '../model/entity-target-of.ts';
import type { ErrorUnion } from '../model/error-union.ts';
import type { HandlerOutput } from '../model/handler-output.ts';
import type { InputSpec } from '../model/input-spec.ts';
import type { InputValue } from '../model/input-value.ts';
import type { NoOutput } from '../model/no-output.ts';
import type { OutputSpec } from '../model/output-spec.ts';
import type { OwnRow } from '../model/own-row.ts';
import type { PageInput } from '../model/page-input.ts';
import type { BaseOf, OwnerOf, PartSource, WhenOf } from '../model/part-source.ts';
import type { Prettify } from '../model/prettify.ts';
import type { TargetName } from '../model/target-name.ts';
import type { WireOutput } from '../model/wire-output.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { Gen } from '../protocol/gen.ts';
import type { Request } from '../protocol/request.ts';
import type { Empty } from '../types/empty.ts';
import { mountName } from './mount-name.ts';
import type { EntityOutputSpec } from './page-of.ts';

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
export interface QueryOptions<
  In,
  Out,
  Er extends readonly AnyErrorDefinition[],
  Pk extends PrincipalKind,
> extends ActionOptions<In, Out, Er, Pk> {
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
  Er extends readonly AnyErrorDefinition[],
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
  Er extends readonly AnyErrorDefinition[],
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
  const In extends InputSpec = Shape<Empty>,
  const Out extends OutputSpec = NoOutput,
  const Er extends readonly AnyErrorDefinition[] = readonly [],
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
  const In extends InputSpec = Shape<Empty>,
  const Out extends OutputSpec = NoOutput,
  const Er extends readonly AnyErrorDefinition[] = readonly [],
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
