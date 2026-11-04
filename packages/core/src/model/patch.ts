import type { FieldsAt } from './fields-at.ts';
import type { NonHidden } from './non-hidden.ts';
import type { PatchOf } from './patch-of.ts';

/** The patch shape of an app's entity. */
export type Patch<P, Ref extends string> = PatchOf<NonHidden<FieldsAt<P, Ref>>>;
