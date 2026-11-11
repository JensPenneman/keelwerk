import type { EgressPolicy } from '../executors/egress-policy.ts';
import type { WorkersProbe } from '../worker/workers-probe.ts';
import type { ProcessDefinition } from './deployment-definition.ts';

/**
 * What a process works (21.1): `RuntimeOptions.work`. Defaults: slots `{ '*': 4 }`, no
 * capabilities, drainSeconds 60.
 */
export interface WorkOptions
  extends Pick<ProcessDefinition, 'slots' | 'capabilities' | 'drainSeconds'> {
  /** Tests: receives the kernel queue's probe once the workers run; a process with the `serve` role has none. */
  readonly probe?: (probe: WorkersProbe) => void;
  /** The outbound policy of this process's executors (12.3, S-131): CIDR blocks exempted from the special-purpose refusal. */
  readonly egress?: EgressPolicy;
}
