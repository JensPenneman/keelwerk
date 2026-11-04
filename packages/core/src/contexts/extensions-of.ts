import type { ExtensionValue } from '../model/extension-value.ts';
import type { Empty } from '../types/empty.ts';

type ExtensionPointsOf<B> = B extends { readonly extensionPoints: infer X } ? X : Empty;

/** `ctx.extensions`: the values filled into the module's own extension points; a `single` point reads as one value. */
export type ExtensionsOf<B> = {
  readonly [K in keyof ExtensionPointsOf<B>]: ExtensionValue<ExtensionPointsOf<B>[K]>;
};
