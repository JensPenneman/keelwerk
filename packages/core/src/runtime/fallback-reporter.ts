import type { AdapterCapabilities } from '../storage/adapter-capabilities.ts';

/**
 * The fallback report of section 14.3.3 as the runtime uses it: for every capability the adapter
 * lacks, the kernel path that runs in its place and what that costs. The rows live in
 * `@keelwerk/data` and the core imports nothing from the workspace (plan rule 9), so a deployment
 * lists this among its infrastructure, as it does the schema planner, and `connect` logs the rows
 * of each placement.
 */
export interface FallbackReporter {
  readonly kind: 'fallbackReporter';
  readonly provides: readonly [];
  report(
    capabilities: AdapterCapabilities,
  ): readonly { readonly capability: string; readonly path: string; readonly cost: string }[];
}
