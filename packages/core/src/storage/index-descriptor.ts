import type { Condition } from '../conditions/condition.ts';

/** An index of an entity, partial ones included. */
export interface IndexDescriptor {
  readonly name: string;
  readonly fields: readonly string[];
  readonly unique: boolean;
  /** A partial index: plaintext fields only. */
  readonly where: Condition | null;
}
