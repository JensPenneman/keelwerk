import type { Summary } from './summary.ts';

/** One row of a table: a label and a summary per column. */
export interface SummaryRow {
  readonly label: string;
  readonly values: readonly Summary[];
}
