import type { Registry } from '../registry/registry.ts';

/** One app the invoker serves. */
export interface InvokerApp {
  readonly registry: Registry;
  /** The app's head API version; `resolveVersion` answers it until pins exist (WP-49). */
  readonly head: string;
}
