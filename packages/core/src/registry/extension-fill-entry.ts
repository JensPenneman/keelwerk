/** What one module contributed to one extension point (section 5.5). */
export interface ExtensionFillEntry {
  /** The point's reference, 'accounts.identityProviders'. */
  readonly point: string;
  /** The contributing module. */
  readonly module: string;
  /** True: the fill is a factory `(own) => value`, instantiated per invocation with the contributor's pure context (gap G16). */
  readonly bound: boolean;
  /** The factory when `bound`, else the plain value. */
  readonly fill: unknown;
  /** Ordered points. */
  readonly order?: number;
}
