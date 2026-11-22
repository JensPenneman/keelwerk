import { defineCheck } from './define-check.ts';
import type { DeploymentCheck } from './deployment-check.ts';
import type { ProcessFact } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';
import { processGoneAfterMs } from './process-gone-after-ms.ts';

/**
 * Health from the running process rows of the control store (section 19.1): a process that
 * is not `ready`, or whose heartbeat is older than the presumed-gone age. A deployment with no
 * process row has no running process.
 */
function healthFindings(processes: readonly ProcessFact[]): readonly DoctorFinding[] {
  if (processes.length === 0) {
    return [
      findingOf(
        'health',
        'warning',
        'processes',
        'the control store lists no process',
        'start the deployment with keelwerk start',
      ),
    ];
  }
  const found: DoctorFinding[] = [];
  for (const process of processes) {
    const subject = process.name ?? process.id;
    if (process.state === 'stopped') continue;
    if (process.heartbeatAgeMs > processGoneAfterMs) {
      found.push(
        findingOf(
          'health',
          'warning',
          subject,
          `process ${subject} last beat ${Math.round(process.heartbeatAgeMs / 1000)} s ago and is presumed gone`,
          'check the node it ran on; stop its row with keelwerk operator',
        ),
      );
    } else if (process.state !== 'ready') {
      found.push(
        findingOf(
          'health',
          'warning',
          subject,
          `process ${subject} is ${process.state}, not ready`,
          'wait for startup or drain to finish, or check its log',
        ),
      );
    }
  }
  return found;
}

export const healthCheck: DeploymentCheck = defineCheck({
  group: 'health',
  name: 'processes',
  needs: ['processes'],
  judge: ({ processes }) => healthFindings(processes),
});
