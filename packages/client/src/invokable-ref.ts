import type { ActionRef } from '@keelwerk/core';
import type { LeafAt } from './leaf-at.ts';

/** Every query and command reference of an app; subscriptions go through `subscribe`. */
export type InvokableRef<App> = {
  [R in ActionRef<App> & string]: LeafAt<App, R> extends { readonly kind: 'subscription' }
    ? never
    : R;
}[ActionRef<App> & string];
