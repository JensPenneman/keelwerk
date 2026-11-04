import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { BucketDemand } from './bucket-demand.ts';

/** The buckets to consume, or a refusal (section 12.2). */
export type AdmissionVerdict =
  | { readonly kind: 'charge'; readonly demand: BucketDemand }
  | { readonly kind: 'refuse'; readonly error: KeelwerkError };
