/** How many values an extension point takes (section 5.5). */
export type ExtensionMode = 'set' | 'ordered' | 'single';

/** Options of a `set` or `ordered` extension point. */
export interface ExtensionPointOptions {
  readonly min?: number;
}

/** A typed slot other modules may fill; the mode is part of the type, so a `single` point reads as `T`. */
export interface ExtensionPoint<T, M extends ExtensionMode = ExtensionMode> {
  readonly kind: 'extensionPoint';
  readonly mode: M;
  readonly options: ExtensionPointOptions;
  readonly '~value'?: T;
}

/**
 * The declarations of extension points, one function per mode (decision 96). `T` is the only type
 * argument of each, because TypeScript infers no other type argument once one is explicit: a mode
 * passed as an option would read as the whole union.
 */
export interface ExtensionPointFactory {
  single<T>(): ExtensionPoint<T, 'single'>;
  set<T>(options?: ExtensionPointOptions): ExtensionPoint<T, 'set'>;
  ordered<T>(options?: ExtensionPointOptions): ExtensionPoint<T, 'ordered'>;
}

/** Declares an extension point: `extensionPoint.set<IdentityProvider>()`. */
export const extensionPoint: ExtensionPointFactory = {
  single: () => ({ kind: 'extensionPoint', mode: 'single', options: {} }),
  set: (options = {}) => ({ kind: 'extensionPoint', mode: 'set', options }),
  ordered: (options = {}) => ({ kind: 'extensionPoint', mode: 'ordered', options }),
};
