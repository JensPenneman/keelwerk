import type { HybridClock } from '../clock/hybrid-clock.ts';
import type { InvokerOptions } from '../invoker/invoker-options.ts';

/** What the explain endpoint runs with: the invoker's own options, so a dry run sees what a real call sees, and the process clock. */
export interface ExplainEnvironment {
  readonly options: Pick<
    InvokerOptions,
    | 'apps'
    | 'directory'
    | 'placement'
    | 'control'
    | 'clock'
    | 'keys'
    | 'compute'
    | 'log'
    | 'environment'
    | 'build'
  >;
  readonly hybridClock: HybridClock;
}
