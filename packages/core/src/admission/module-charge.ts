import type { BucketCharge } from '../edge/bucket-demand.ts';

/** A bucket charge with the module whose rule returned it: the module scopes the bucket's name (S-86). */
export interface ModuleCharge {
  readonly module: string;
  readonly charge: BucketCharge;
}
