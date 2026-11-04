/** The public answer of `core.capabilities` and `GET /_keelwerk/v1/capabilities` (section 18.7). */
export interface CapabilitiesDocument {
  /** Protocol name to the majors served: `{ invocation: [1] }`. */
  readonly protocols: Readonly<Record<string, readonly number[]>>;
  readonly apiVersions: readonly {
    readonly version: string;
    readonly status: 'current' | 'deprecated' | 'retired';
    readonly deprecated?: { readonly at: string; readonly sunset: string };
  }[];
}
