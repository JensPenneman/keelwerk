import type { FieldConstraints } from './field-constraints.ts';
import type { FieldDescriptor } from './field-descriptor.ts';

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
}
