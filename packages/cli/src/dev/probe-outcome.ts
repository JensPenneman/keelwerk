import type { ProbeResult } from './probe-result.ts';

/** The probe of one cycle: its result, or why there is none. */
export type ProbeOutcome =
  | { readonly kind: 'done'; readonly result: ProbeResult }
  | { readonly kind: 'failed'; readonly message: string };
