import type { ActionPart, PartTypes } from './action-part.ts';
import type { AnyErrorSpec } from './define-error.ts';
import type { LiveSource, StateToken } from './live-source.ts';
import type { ActionOptions, ErrorUnion, InputSpec, InputValue } from './part-io.ts';
import type { BaseOf, OwnerOf, PartSource, WhenOf } from './part-source.ts';
import type { PrincipalKind } from './principal.ts';
import type { Shape, ShapeFields } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';
import type { SourceContext } from './source-context.ts';

/** A subscription literal: `source` builds a live source description (section 7.3). */
export interface SubscriptionSpec<
  S,
  In,
  EventFields extends ShapeFields,
  Er extends readonly AnyErrorSpec[],
  Pk extends PrincipalKind,
> extends Omit<ActionOptions<In, never, Er, Pk>, 'output'> {
  readonly event: Shape<EventFields>;
  readonly source: (
    input: InputValue<In, OwnerOf<S>>,
    ctx: SourceContext<BaseOf<S>, WhenOf<S>, Pk>,
    resume: StateToken | undefined,
  ) => LiveSource<ShapeValue<EventFields, OwnerOf<S>, 'draft'>>;
}

/** Defines a subscription (section 4.3). */
export function defineSubscription<
  const S extends PartSource,
  const EventFields extends ShapeFields,
  const In extends InputSpec = Shape<{}>,
  const Er extends readonly AnyErrorSpec[] = readonly [],
  const Pk extends PrincipalKind = PrincipalKind,
>(
  source: S,
  spec: SubscriptionSpec<S, In, EventFields, Er, Pk>,
): ActionPart<
  'subscription',
  S,
  null,
  'sync',
  PartTypes<
    InputValue<In, OwnerOf<S>>,
    ShapeValue<EventFields, OwnerOf<S>, 'stored'>,
    ErrorUnion<Er>,
    ShapeValue<EventFields, OwnerOf<S>, 'stored'>
  >
> {
  return { kind: 'subscription', source, mount: null, execution: 'sync', spec };
}
