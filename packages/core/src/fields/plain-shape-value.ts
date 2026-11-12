import type { SecretRef } from '../ids/secret-ref.ts';
import type { Prettify } from '../model/prettify.ts';
import type { FieldKind } from '../storage/field-kind.ts';
import type { FieldDef, FieldRef } from './field-def.ts';
import type { FieldFlags } from './field-flags.ts';
import type { FieldValue } from './shape-value.ts';

/** The element type of a stored list or set value. */
type ElementOf<V> = V extends readonly (infer E)[] ? E : V extends ReadonlySet<infer E> ? E : never;

/** Whether a stored list or set value holds secret references. */
type HoldsSecret<V> = [ElementOf<V>] extends [never]
  ? false
  : [ElementOf<V>] extends [SecretRef]
    ? true
    : false;

/** Whether the field's value is sealed in a record: personal, a secret or a verifier, or a list or set of secrets. */
type SealedField<Fd, Owner extends string> =
  Fd extends FieldDef<unknown, infer Fl extends FieldFlags, FieldRef, infer K extends FieldKind>
    ? Fl['personal'] extends false
      ? [K] extends ['secret' | 'verifier']
        ? true
        : [K] extends ['list' | 'set']
          ? HoldsSecret<FieldValue<Fd, Owner, 'stored'>>
          : false
      : true
    : true;

/** Whether a plain member may be absent: declared optional, or a list or set (the type does not show a personal or verifier element). */
type MaybeAbsent<Fd> = Fd extends { readonly flags: { readonly optional: true } }
  ? true
  : Fd extends { readonly kind: 'list' | 'set' }
    ? true
    : false;

/**
 * The stored value of the members of `F` a record keeps in plaintext (S-166), the type twin of
 * `plainInputMembers`: a field whose type is personal (`flags.personal` is not `false`) or of kind
 * `secret` or `verifier`, and a list or set whose stored value holds a `SecretRef`, are left out;
 * any other list or set is optional, because the type of a list or set does not show a personal or
 * verifier element (such a member is absent at runtime). Every other member is as
 * `ShapeValue<F, Owner, 'stored'>` has it.
 */
export type PlainShapeValue<F, Owner extends string> = Prettify<
  {
    readonly [K in keyof F as SealedField<F[K], Owner> extends true
      ? never
      : MaybeAbsent<F[K]> extends true
        ? never
        : K]: FieldValue<F[K], Owner, 'stored'>;
  } & {
    readonly [K in keyof F as SealedField<F[K], Owner> extends true
      ? never
      : MaybeAbsent<F[K]> extends true
        ? K
        : never]?: FieldValue<F[K], Owner, 'stored'> | undefined;
  }
>;
