import { errors } from '../errors/errors.ts';

/** How many values an extension point takes (section 5.5). */
export type ExtensionMode = 'set' | 'ordered' | 'single';

/** Options of an extension point; `min: 0` lets a `single` point stay empty (section 5.5). */
export interface ExtensionPointOptions {
  readonly min?: number;
}

/**
 * A typed slot other modules may fill; the mode is part of the type, so a `single` point reads as
 * `T`; one declared with `min: 0` (`O` is true) reads `T | undefined`, because it may stay unfilled.
 */
export interface ExtensionPoint<
  T,
  M extends ExtensionMode = ExtensionMode,
  O extends boolean = false,
> {
  readonly kind: 'extensionPoint';
  readonly mode: M;
  readonly options: ExtensionPointOptions;
  readonly '~value'?: T;
  /** True for a `single` point declared with `min: 0`: it reads `T | undefined`. */
  readonly '~optional'?: O;
}

/**
 * The declarations of extension points, one function per mode (decision 96). `T` is the only type
 * argument of each, because TypeScript infers no other type argument once one is explicit: a mode
 * passed as an option would read as the whole union.
 */
export interface ExtensionPointFactory {
  /** A single point takes a `min` of 0 (it may stay empty and reads `T | undefined`) or 1 (the default). */
  single<T>(options: { readonly min: 0 }): ExtensionPoint<T, 'single', true>;
  single<T>(options?: { readonly min?: 1 }): ExtensionPoint<T, 'single'>;
  set<T>(options?: ExtensionPointOptions): ExtensionPoint<T, 'set'>;
  ordered<T>(options?: ExtensionPointOptions): ExtensionPoint<T, 'ordered'>;
}

/** Declares an extension point: `extensionPoint.set<IdentityProvider>()`. */
export const extensionPoint: ExtensionPointFactory = {
  single: (options: { readonly min?: number } = {}) => {
    if (options.min !== undefined && options.min !== 0 && options.min !== 1) {
      throw errors.validation('a single extension point takes min 0 or 1');
    }
    return { kind: 'extensionPoint', mode: 'single', options };
  },
  set: (options = {}) => ({ kind: 'extensionPoint', mode: 'set', options }),
  ordered: (options = {}) => ({ kind: 'extensionPoint', mode: 'ordered', options }),
};
