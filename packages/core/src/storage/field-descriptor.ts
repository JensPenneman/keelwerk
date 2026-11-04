import type { FieldConstraints } from './field-constraints.ts';
import type { FieldKind } from './field-kind.ts';
import type { NormalizerRef } from './normalizer-ref.ts';
import type { PersonalParams } from './personal-params.ts';
import type { PersonalQuery } from './personal-query.ts';

/** One field as an adapter sees it. */
export interface FieldDescriptor {
  readonly kind: FieldKind;
  readonly column: string;
  readonly optional: boolean;
  readonly unique: boolean;
  readonly indexed: boolean;
  /** `history`: kept in before-images (opt-in with a reason). */
  readonly hidden: false | { readonly history: boolean };
  readonly maskable: boolean;
  /** Never written to events or before-images (section 6.6). */
  readonly stateOnly: boolean;
  /** Credential material: secret and verifier kinds, sealed per value (section 14.7.4). */
  readonly sealed: boolean;
  readonly merge: 'lww' | 'max' | 'min' | 'counter' | 'set' | 'sequence' | 'richText' | 'exclusive';
  /** `subject`: the entity's dataSubject or another field of the row; the rest: section 14.7.9.2. */
  readonly personal:
    | false
    | {
        readonly subject: string;
        readonly queries: readonly PersonalQuery[];
        readonly normalize: NormalizerRef;
        readonly params: PersonalParams;
        readonly keys: 'tenant' | 'subject';
      };
  readonly constraints: FieldConstraints;
  readonly ref: { readonly entity: string; readonly foreignKey: boolean } | null;
  /** Element of set and list. */
  readonly inner: FieldDescriptor | null;
  /** CRDT codec of sequence and richText fields, for example 'loro/1'. */
  readonly codec: string | null;
  readonly tag: number;
}
