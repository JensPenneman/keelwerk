import type { FieldKind } from '../storage/field-kind.ts';

/** One field a data-subject path passes through, as the compose check reads it. */
export interface PathField {
  readonly kind: FieldKind;
  readonly personal: boolean;
  readonly sealed: boolean;
  /** The ref of the entity a reference field points at, else null. */
  readonly target: string | null;
}
