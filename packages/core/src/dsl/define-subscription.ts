import type { SourceContext } from '../contexts/source-context.ts';
import type { AnyErrorDefinition } from '../errors/error-definition.ts';
import type { StateToken } from '../events/state-token.ts';
import type { Shape, ShapeFields } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { ActionOptions } from '../model/action-options.ts';
import type { ActionPart, PartTypes } from '../model/action-part.ts';
import type { ErrorUnion } from '../model/error-union.ts';
import type { InputSpec } from '../model/input-spec.ts';
import type { InputValue } from '../model/input-value.ts';
import type { LiveSource } from '../model/live-source.ts';
import type { BaseOf, OwnerOf, PartSource, WhenOf } from '../model/part-source.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { Empty } from '../types/empty.ts';

/** A subscription literal: `source` builds a live source description (section 7.3). */
export interface SubscriptionSpec<
  S,
  In,
  EventFields extends ShapeFields,
  Er extends readonly AnyErrorDefinition[],
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
  const In extends InputSpec = Shape<Empty>,
  const Er extends readonly AnyErrorDefinition[] = readonly [],
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
