import type { Condition } from '../conditions/condition.ts';

/** A dialect-neutral index. */
export interface IndexSpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly method: 'btree' | 'gin';
  /** A partial index. */
  readonly where: Condition | null;
}
