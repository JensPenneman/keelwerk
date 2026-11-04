import type { Row } from '@keelwerk/core';

type EntityExists<App, Ref extends string> = Ref extends unknown
  ? [Row<App, Ref>] extends [never]
    ? false
    : true
  : never;

/**
 * `true` when the app has the entity `Ref` ('accounts.profile'), otherwise `false`; for a union of
 * references, `true` only when the app has every one.
 */
export type HasEntity<App, Ref extends string> = [EntityExists<App, Ref>] extends [true]
  ? true
  : false;
