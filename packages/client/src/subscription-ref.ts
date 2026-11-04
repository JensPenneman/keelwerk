import type { ActionRef } from '@keelwerk/core';
import type { LeafAt } from './leaf-at.ts';

/** Every subscription reference of an app. */
export type SubscriptionRef<App> = {
  [R in ActionRef<App> & string]: LeafAt<App, R> extends { readonly kind: 'subscription' }
    ? R
    : never;
}[ActionRef<App> & string];
