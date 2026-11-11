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
}
