import type { AnyActionPart } from './action-part.ts';
import type { EffectDraft } from './decision.ts';
import type { OwnerOf, PartSource } from './part-source.ts';
import type { Shape, ShapeFields } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';

/** Options of an effect request: the continuation and its extra input, a key and timing. */
export interface EffectOptions {
  readonly continueWith?: AnyActionPart;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly key?: string;
  readonly runAt?: Temporal.Instant;
  readonly deadline?: Temporal.Instant;
}

/** An external effect, constructed by value in a decision (section 7.9.5). */
export interface Effect<S, Din, Sin, O> {
  (input: Din, options?: EffectOptions): EffectDraft<O>;
  readonly kind: 'effect';
  readonly source: S;
  readonly performer: 'executor' | 'external';
  readonly '~types'?: { readonly input: Sin; readonly output: O };
}

/** Any effect. */
export type AnyEffect = Effect<unknown, never, unknown, unknown>;

/** Declares an external effect; its input states everything it does. */
export function defineEffect<
  const S extends PartSource,
  const InFields extends ShapeFields,
  const OutFields extends ShapeFields = {},
>(
  source: S,
  spec: {
    readonly input: Shape<InFields>;
    readonly output?: Shape<OutFields>;
    readonly performer?: 'executor' | 'external';
  },
): Effect<
  S,
  ShapeValue<InFields, OwnerOf<S>, 'draft'>,
  ShapeValue<InFields, OwnerOf<S>, 'stored'>,
  ShapeValue<OutFields, OwnerOf<S>, 'stored'>
> {
  const draft = (): EffectDraft<ShapeValue<OutFields, OwnerOf<S>, 'stored'>> => ({
    kind: 'effect',
    type: 'external',
  });
  return Object.assign(draft, {
    kind: 'effect' as const,
    source,
    performer: spec.performer ?? 'executor',
  });
}
