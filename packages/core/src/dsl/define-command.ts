import type { DecideContext } from '../contexts/decide-context.ts';
import type { PrepareContext } from '../contexts/prepare-context.ts';
import type { AnyErrorDefinition } from '../errors/error-definition.ts';
import type { Shape } from '../fields/shape.ts';
import type { ActionOptions } from '../model/action-options.ts';
import type {
  ActionPart,
  AnyActionPart,
  Execution,
  PartTypes,
  RowOutput,
} from '../model/action-part.ts';
import type { CurrentRow } from '../model/current-row.ts';
import type { EntityTargetOf } from '../model/entity-target-of.ts';
import type { ErrorUnion } from '../model/error-union.ts';
import type { EventTarget } from '../model/event-target.ts';
import type { HandlerOutput } from '../model/handler-output.ts';
import type { InputSpec } from '../model/input-spec.ts';
import type { InputValue } from '../model/input-value.ts';
import type { InstanceInput } from '../model/instance-input.ts';
import type { NoOutput } from '../model/no-output.ts';
import type { OutputSpec } from '../model/output-spec.ts';
import type { BaseOf, OwnerOf, PartSource, WhenOf } from '../model/part-source.ts';
import type { Prettify } from '../model/prettify.ts';
import type { TargetName } from '../model/target-name.ts';
import type { TargetRef } from '../model/target-ref.ts';
import type { WireOutput } from '../model/wire-output.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { Decision } from '../protocol/decision.ts';
import type { Gen } from '../protocol/gen.ts';
import type { Empty } from '../types/empty.ts';
import { mountName } from './mount-name.ts';

type Prepare<S, In, P, Pk extends PrincipalKind> = (
  input: InputValue<In, OwnerOf<S>>,
  ctx: PrepareContext<BaseOf<S>, WhenOf<S>, Pk>,
) => P | Gen<P>;

/** `prepare` exists only on `execution: 'sync'` commands: inline effects need the caller waiting (section 7.9.4). */
export type PrepareOf<X extends Execution, S, In, P, Pk extends PrincipalKind> = [X] extends [
  'sync',
]
  ? Prepare<S, In, P, Pk>
  : never;

/** Options of commands (section 7.3). */
export interface CommandOptions<
  In,
  Out,
  Er extends readonly AnyErrorDefinition[],
  X extends Execution,
  Pk extends PrincipalKind,
> extends ActionOptions<In, Out, Er, Pk> {
  readonly execution?: X;
  readonly async?: object;
  readonly isolation?: 'read-committed' | 'serializable';
  readonly idempotency?: { readonly window: string };
  readonly offline?: boolean;
  readonly trace?: { readonly input: 'sealed'; readonly retention?: string };
}

/** A module-level (or app-level) command literal. */
export interface ModuleCommandSpec<
  S,
  In,
  Out,
  Er extends readonly AnyErrorDefinition[],
  X extends Execution,
  Pk extends PrincipalKind,
  P,
> extends CommandOptions<In, Out, Er, X, Pk> {
  readonly prepare?: PrepareOf<X, S, In, P, Pk>;
  readonly decide: (
    input: InputValue<In, OwnerOf<S>>,
    ctx: DecideContext<BaseOf<S>, WhenOf<S>, P, Pk>,
  ) => Decision<HandlerOutput<Out, S, void>> | Gen<Decision<HandlerOutput<Out, S, void>>>;
}

/** An entity-mounted command literal: `decide` also receives the full current row. */
export interface EntityCommandSpec<
  S,
  T,
  In,
  Out,
  Er extends readonly AnyErrorDefinition[],
  X extends Execution,
  Pk extends PrincipalKind,
  P,
> extends CommandOptions<In, Out, Er, X, Pk> {
  readonly prepare?: PrepareOf<X, S, In, P, Pk>;
  readonly decide: (
    input: InputValue<In, OwnerOf<S>>,
    current: CurrentRow<S, T>,
    ctx: DecideContext<BaseOf<S>, WhenOf<S>, P, Pk, EventTarget<S, T>>,
  ) => Decision<HandlerOutput<Out, S, never>> | Gen<Decision<HandlerOutput<Out, S, never>>>;
}

/** Defines a command typed against a base, a `within` narrowing or an app selection (section 4.3). */
export function defineCommand<
  const S extends PartSource,
  const In extends InputSpec = Shape<Empty>,
  const Out extends OutputSpec = NoOutput,
  const Er extends readonly AnyErrorDefinition[] = readonly [],
  const X extends Execution = 'sync',
  const Pk extends PrincipalKind = PrincipalKind,
  P = undefined,
>(
  source: S,
  spec: ModuleCommandSpec<S, In, Out, Er, X, Pk, P>,
): ActionPart<
  'command',
  S,
  null,
  X,
  PartTypes<InputValue<In, OwnerOf<S>>, WireOutput<Out, S, void>, ErrorUnion<Er>, never>
>;
export function defineCommand<
  const S extends PartSource,
  const T extends EntityTargetOf<S>,
  const In extends InputSpec = Shape<Empty>,
  const Out extends OutputSpec = NoOutput,
  const Er extends readonly AnyErrorDefinition[] = readonly [],
  const X extends Execution = 'sync',
  const Pk extends PrincipalKind = PrincipalKind,
  P = undefined,
>(
  source: S,
  target: T,
  spec: EntityCommandSpec<S, T, In, Out, Er, X, Pk, P>,
): ActionPart<
  'command',
  S,
  TargetName<S, T>,
  X,
  PartTypes<
    Prettify<InputValue<In, OwnerOf<S>> & InstanceInput<TargetRef<S, T>>>,
    WireOutput<Out, S, RowOutput<TargetRef<S, T>>>,
    ErrorUnion<Er>,
    never
  >
>;
export function defineCommand(
  source: object,
  targetOrSpec: unknown,
  maybeSpec?: object,
): AnyActionPart {
  const spec = (maybeSpec ?? targetOrSpec) as { readonly execution?: Execution };
  return {
    kind: 'command',
    source,
    mount: maybeSpec === undefined ? null : mountName(source, targetOrSpec),
    execution: spec.execution ?? 'sync',
    spec,
  };
}
