/** How many values an extension point takes (section 5.5). */
export type ExtensionMode = 'set' | 'ordered' | 'single';

/** Options of an extension point. */
export interface ExtensionPointOptions {
  readonly mode: ExtensionMode;
  readonly min?: number;
}

/** A typed slot other modules may fill. */
export interface ExtensionPoint<T> {
  readonly kind: 'extensionPoint';
  readonly options: ExtensionPointOptions;
  readonly '~value'?: T;
}

/**
 * Declares an extension point. The mode is not part of the type: `extensionPoint<T>({ mode })`
 * gives `T` explicitly, and TypeScript infers no other type argument once one is explicit.
 */
export function extensionPoint<T>(options: ExtensionPointOptions): ExtensionPoint<T> {
  return { kind: 'extensionPoint', options };
}
