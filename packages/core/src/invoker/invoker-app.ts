import type { ApiVersions } from '../dsl/define-api-versions.ts';
import type { Registry } from '../registry/registry.ts';

/** One app the invoker serves. */
export interface InvokerApp {
  readonly registry: Registry;
  /** The app's head API version. */
  readonly head: string;
  /** The app's declared versions; absent, `head` is the only version served. */
  readonly api?: ApiVersions;
}
