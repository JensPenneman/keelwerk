import type { FieldsAt } from './fields-at.ts';
import type { NonHidden } from './non-hidden.ts';
import type { OfflinePatchOf } from './offline-patch-of.ts';

/** The patch an offline mutation may carry: exclusive and unique fields excluded. */
export type OfflinePatch<P, Ref extends string> = OfflinePatchOf<NonHidden<FieldsAt<P, Ref>>>;
