/** An extension point a module declares (section 5.5). */
export interface ExtensionPointEntry {
  /** 'accounts.identityProviders'. */
  readonly ref: string;
  /** The declaring module. */
  readonly module: string;
  readonly name: string;
  readonly mode: 'set' | 'ordered' | 'single';
  /** An empty slot below `min` is the boot problem `emptyExtensionPoints`. */
  readonly min?: number;
  /** `single` points: the owner declared a default. */
  readonly hasDefault: boolean;
}
