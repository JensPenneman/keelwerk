import { seeds } from './seeds.ts';

/** Every table whose rows carry a scope id. */
export const scopedTableNames: readonly string[] = [
  ...seeds.map(([table]) => table),
  'kw_job_lane_counts',
  'kw_jobs',
];
