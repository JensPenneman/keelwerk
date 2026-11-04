import type { PatchValue } from './patch-of.ts';
import type { Prettify } from './prettify.ts';

/** The patch an offline mutation may carry: exclusive and unique fields excluded (section 15.3.5). */
export type OfflinePatchOf<F, Owner extends string = string> = Prettify<{
  readonly [K in keyof F as F[K] extends
    | { readonly kind: 'serial' }
    | { readonly flags: { readonly merge: 'exclusive' } }
    | { readonly flags: { readonly unique: true } }
    ? never
    : K]?: PatchValue<F[K], Owner>;
}>;
