import type { BenchCell } from './bench-cell.ts';
import type { StatementCount } from './statement-count.ts';

/** The statements one cell sends to PostgreSQL, per command. */
export interface StatementProfile {
  readonly cell: BenchCell;
  readonly commands: number;
  readonly statements: readonly StatementCount[];
}
