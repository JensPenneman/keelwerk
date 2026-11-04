import type { ComposableApp } from '../registry/composable-app.ts';
import type { Registry } from '../registry/registry.ts';

/** What the surface is derived from: the app value `defineApp` returns, with its composed registry. */
export interface SurfaceSource extends ComposableApp {
  readonly registry: Registry;
}
