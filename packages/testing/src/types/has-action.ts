import type { ActionRef } from '@keelwerk/core';

/**
 * `true` when the app has the action `Ref` ('accounts.profile.changePassword'), otherwise `false`;
 * for a union of references, `true` only when the app has every one.
 */
export type HasAction<App, Ref extends string> = [Ref] extends [ActionRef<App>] ? true : false;
