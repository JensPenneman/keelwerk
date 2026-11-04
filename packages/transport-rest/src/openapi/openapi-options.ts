import type { SecurityResolver } from './security-resolver.ts';

/** What shapes the OpenAPI document; the static options of the REST module (section 16.3.2). */
export interface OpenapiOptions {
  /** The `servers` URL of the committed file; default `/api`. */
  readonly basePath?: string;
  /** `3.1` (default) emits 3.1.1; `3.2` emits 3.2.0 with `QUERY` operations, `itemSchema` and nested tags. */
  readonly openapi?: '3.1' | '3.2';
  /** The principal resolvers for the security schemes; default: the ones the surface describes (`ApiSurface.resolvers`). */
  readonly resolvers?: readonly SecurityResolver[];
}
