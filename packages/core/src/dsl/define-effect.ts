import type { PlainShapeValue } from '../fields/plain-shape-value.ts';
import type { Shape, ShapeFields } from '../fields/shape.ts';
import { shape } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { AnyActionPart } from '../model/action-part.ts';
import type { OwnerOf, PartSource } from '../model/part-source.ts';
import type { ExternalEffect } from '../protocol/external-effect.ts';
import type { Empty } from '../types/empty.ts';
import { refOf } from './ref-of.ts';

/** Options of an effect request: the continuation and its extra input, a key and timing. */
export interface EffectOptions {
  readonly continueWith?: AnyActionPart;
  /** Stored in plaintext next to the sealed input: a member the continuation's input declares personal or secret is refused. */
  readonly with?: Readonly<Record<string, unknown>>;
  /** Stored in plaintext in the record: it must not carry a personal or secret value. */
  readonly key?: string;
  readonly runAt?: Temporal.Instant;
  readonly deadline?: Temporal.Instant;
}

/** An external effect, constructed by value in a decision (section 7.9.5). */
export interface EffectPart<S, Din, Sin, O, P = Sin> {
  (input: Din, options?: EffectOptions): ExternalEffect<O>;
  readonly kind: 'effect';
  readonly source: S;
  readonly performer: 'executor' | 'external';
  /** The input shape: it states everything the effect does (F-11b change note). */
  readonly input: Shape;
  /** The output shape; the empty shape when the effect declares none. */
  readonly output: Shape;
  /** The path in the input that holds the data subject of its personal fields (S-127). */
  readonly dataSubject?: string;
  /** The reference (`hooks.post`) `defineModule` records; it is the `type` of the effect payload. */
  readonly ref?: string;
  /** `plain`: the members of the stored input a record keeps in plaintext (S-166), what a pending effect carries. */
  readonly '~types'?: { readonly input: Sin; readonly output: O; readonly plain: P };
}

/** Any effect. */
export type AnyEffectPart = EffectPart<unknown, never, unknown, unknown>;

/** Declares an external effect; its input states everything it does. */
export function defineEffect<
  const S extends PartSource,
  const InFields extends ShapeFields,
  const OutFields extends ShapeFields = Empty,
>(
  source: S,
  spec: {
    readonly input: Shape<InFields>;
    readonly output?: Shape<OutFields>;
    readonly performer?: 'executor' | 'external';
    /** The input field that holds the data subject of the personal input fields, or a path through references from it (S-127). */
    readonly dataSubject?: (keyof InFields & string) | `${keyof InFields & string}.${string}`;
  },
): EffectPart<
  S,
  ShapeValue<InFields, OwnerOf<S>, 'draft'>,
  ShapeValue<InFields, OwnerOf<S>, 'stored'>,
  ShapeValue<OutFields, OwnerOf<S>, 'stored'>,
  PlainShapeValue<InFields, OwnerOf<S>>
> {
  const construct = (
    input: ShapeValue<InFields, OwnerOf<S>, 'draft'>,
    options: EffectOptions = {},
  ): ExternalEffect<ShapeValue<OutFields, OwnerOf<S>, 'stored'>> =>
    Object.freeze({
      kind: 'external',
      type: refOf(construct),
      input,
      ...(options.continueWith === undefined ? {} : { continueWith: refOf(options.continueWith) }),
      ...(options.with === undefined ? {} : { with: options.with }),
      ...(options.key === undefined ? {} : { key: options.key }),
      ...(options.runAt === undefined ? {} : { runAt: options.runAt }),
      ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
    });
  return Object.assign(construct, {
    kind: 'effect' as const,
    source,
    performer: spec.performer ?? ('executor' as const),
    input: spec.input as Shape,
    output: (spec.output ?? shape({})) as Shape,
    ...(spec.dataSubject === undefined ? {} : { dataSubject: spec.dataSubject as string }),
  });
}
