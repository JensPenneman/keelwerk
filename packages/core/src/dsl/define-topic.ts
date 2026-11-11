import type { DecideContext } from '../contexts/decide-context.ts';
import type { Shape, ShapeFields } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { BaseOf, OwnerOf, PartSource, WhenOf } from '../model/part-source.ts';
import type { Decision } from '../protocol/decision.ts';
import type { Gen } from '../protocol/gen.ts';

/** A hook run when a topic key gains its first subscriber or loses its last. */
type TopicHook<S, Kf extends ShapeFields> = (
  key: ShapeValue<Kf, OwnerOf<S>, 'value'>,
  ctx: DecideContext<BaseOf<S>, WhenOf<S>>,
) => Decision | Gen<Decision>;

/** The literal of a topic: the shape of its key and of what it publishes. */
export interface TopicSpec<S, Kf extends ShapeFields, Rf extends ShapeFields> {
  readonly key: Shape<Kf>;
  readonly record: Shape<Rf>;
  readonly onFirstSubscriber?: TopicHook<S, Kf>;
  readonly onLastSubscriberLeft?: TopicHook<S, Kf>;
}

/** A topic part: never stored, mounted as `topics.<name>`. */
export interface TopicPart<S, Kf extends ShapeFields, Rf extends ShapeFields> {
  readonly kind: 'topic';
  readonly source: S;
  readonly spec: TopicSpec<S, Kf, Rf>;
}

/** Declares a topic of the module (section 15.1.12, G6). */
export function defineTopic<
  const S extends PartSource,
  const Kf extends ShapeFields,
  const Rf extends ShapeFields,
>(source: S, spec: TopicSpec<S, Kf, Rf>): TopicPart<S, Kf, Rf> {
  return { kind: 'topic', source, spec };
}
