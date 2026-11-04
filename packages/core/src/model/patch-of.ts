import type { FieldDef, FieldRef } from '../fields/field-def.ts';
import type { FieldFlags } from '../fields/field-flags.ts';
import type { FieldValue } from '../fields/shape-value.ts';
import type { Prettify } from './prettify.ts';

declare const crdtBrand: unique symbol;

/** An opaque CRDT update of a collaborative or sequence field (section 15.3.9). */
export interface CrdtUpdate {
  readonly [crdtBrand]: true;
}

/** The patch value of one field: field operations for merge types, `null` clears an optional field (section 14.8.1). */
export type PatchValue<Fd, Owner extends string = string> = Fd extends {
  readonly flags: { readonly merge: 'counter' };
}
  ? number | { readonly inc: number }
  : Fd extends FieldDef<ReadonlySet<infer T>, FieldFlags, FieldRef, 'set'>
    ? ReadonlySet<T> | { readonly add?: readonly T[]; readonly remove?: readonly T[] }
    : Fd extends FieldDef<unknown, FieldFlags, FieldRef, 'richText'>
      ? string | { readonly crdt: CrdtUpdate }
      : Fd extends FieldDef<
            readonly (infer T)[],
            { readonly merge: 'sequence' } & FieldFlags,
            FieldRef,
            'list'
          >
        ? readonly T[] | { readonly crdt: CrdtUpdate }
        : Fd extends { readonly flags: { readonly optional: true } }
          ? FieldValue<Fd, Owner, 'draft'> | null
          : FieldValue<Fd, Owner, 'draft'>;

/** The patch shape of a set of fields: every field optional, each with its patch value; serial fields are read-only. */
export type PatchOf<F, Owner extends string = string> = Prettify<{
  readonly [K in keyof F as F[K] extends { readonly kind: 'serial' } ? never : K]?: PatchValue<
    F[K],
    Owner
  >;
}>;
