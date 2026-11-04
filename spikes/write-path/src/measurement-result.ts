import type { ResultRow } from './result-row.ts';

/** The rows and findings of one measurement, tied to the specification section it checks. */
export interface MeasurementResult {
  readonly id: string;
  readonly title: string;
  readonly sections: string;
  readonly rows: readonly ResultRow[];
  readonly notes: readonly string[];
}
