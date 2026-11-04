import type { FieldsAt } from './fields-at.ts';
import type { InsertOf } from './insert-of.ts';
import type { NonHidden } from './non-hidden.ts';

/** The insert shape of an app's entity (section 14.8.1). */
export type Insert<P, Ref extends string> = InsertOf<NonHidden<FieldsAt<P, Ref>>>;
