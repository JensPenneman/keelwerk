import type { DerivedIndexField } from './derived-index-field.ts';
import type { FieldConstraints } from './field-constraints.ts';
import type { FieldDescriptor } from './field-descriptor.ts';
import type { PersonalQuery } from './personal-query.ts';

/** A dialect-neutral column; adapters render it through their schema builder (section 14.6.2). */
export interface ColumnSpec {
  /** Physical. */
  readonly name: string;
  /** Null for system and framework columns. */
  readonly field: string | null;
  /** `sealed` and `tags`: personal values and their index columns (section 14.7.9.6). */
  readonly kind: FieldDescriptor['kind'] | 'uuid' | 'sealed' | 'tags' | 'framework';
  readonly nullable: boolean;
  /** A literal, never an expression. */
  readonly default: string | number | boolean | null;
  /** The parts a column carries: length, precision and scale, enum values. */
  readonly constraints: FieldConstraints;
  /**
   * Set on the derived index columns of a personal field (`kind: 'tags'`): the capability the column
   * answers and the kind of the derived index field, from which an adapter picks the column type
   * (section 14.7.9.6).
   */
  readonly derived?: {
    readonly query: PersonalQuery;
    readonly kind: DerivedIndexField['kind'];
    readonly unicode?: DerivedIndexField['unicode'];
  };
}
