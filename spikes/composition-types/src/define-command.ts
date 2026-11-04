import type { ActionPart, AnyActionPart, Execution, PartTypes, RowOutput } from './action-part.ts';
import type { DecideContext } from './decide-context.ts';
import type { Decision } from './decision.ts';
import type { AnyErrorSpec } from './define-error.ts';
import { mountName } from './mount-name.ts';
import type {
  ActionOptions,
  CurrentRow,
  EntityTargetOf,
  ErrorUnion,
  EventTarget,
  HandlerOutput,
  InputSpec,
  InputValue,
  InstanceInput,
  NoOutput,
  OutputSpec,
  TargetName,
  TargetRef,
  WireOutput,
} from './part-io.ts';
import type { BaseOf, OwnerOf, PartSource, WhenOf } from './part-source.ts';
import type { PrepareContext } from './prepare-context.ts';
import type { Prettify } from './prettify.ts';
import type { PrincipalKind } from './principal.ts';
import type { Gen } from './request.ts';
import type { Shape } from './shape.ts';

type Prepare<S, In, P, Pk extends PrincipalKind> = (
  input: InputValue<In, OwnerOf<S>>,
  ctx: PrepareContext<BaseOf<S>, WhenOf<S>, Pk>,
) => P | Gen<P>;

/** Options of commands (section 7.3). */
export interface CommandOptions<
  In,
  Out,
  Er extends readonly AnyErrorSpec[],
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
  Er extends readonly AnyErrorSpec[],
  X extends Execution,
  Pk extends PrincipalKind,
  P,
> extends CommandOptions<In, Out, Er, X, Pk> {
  readonly prepare?: Prepare<S, In, P, Pk>;
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
  Er extends readonly AnyErrorSpec[],
  X extends Execution,
  Pk extends PrincipalKind,
  P,
> extends CommandOptions<In, Out, Er, X, Pk> {
  readonly prepare?: Prepare<S, In, P, Pk>;
  readonly decide: (
    input: InputValue<In, OwnerOf<S>>,
    current: CurrentRow<S, T>,
    ctx: DecideContext<BaseOf<S>, WhenOf<S>, P, Pk, EventTarget<S, T>>,
  ) => Decision<HandlerOutput<Out, S, never>> | Gen<Decision<HandlerOutput<Out, S, never>>>;
}

/** Defines a command typed against a base, a `within` narrowing or an app selection (section 4.3). */
export function defineCommand<
  const S extends PartSource,
  const In extends InputSpec = Shape<{}>,
  const Out extends OutputSpec = NoOutput,
  const Er extends readonly AnyErrorSpec[] = readonly [],
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
  const In extends InputSpec = Shape<{}>,
  const Out extends OutputSpec = NoOutput,
  const Er extends readonly AnyErrorSpec[] = readonly [],
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
