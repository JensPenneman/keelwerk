import type { ApiVersions } from '../dsl/define-api-versions.ts';
import type { Shape } from '../fields/shape.ts';
import type { LiveHub } from '../live/live-hub.ts';
import type { Registry } from '../registry/registry.ts';

/** One app the invoker serves. */
export interface InvokerApp {
  readonly registry: Registry;
  /** The app's head API version. */
  readonly head: string;
  /** The app's declared versions; absent, `head` is the only version served. */
  readonly api?: ApiVersions;
  /** The config shape of each module that declares one, by module id (5.7); a module without a shape has no `ctx.config`. */
  readonly configShapes?: ReadonlyMap<string, Shape>;
  /** The live hub this runtime opened for the app; absent when the app has no live module. */
  readonly liveHub?: LiveHub;
}
