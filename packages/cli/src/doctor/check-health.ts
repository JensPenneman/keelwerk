import type { ProcessFact } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';
import { processGoneAfterMs } from './process-gone-after-ms.ts';

/**
 * Health from the running process rows of the control store (section 19.1): a process that
 * is not `ready`, or whose heartbeat is older than the presumed-gone age. A deployment with no
 * process row has no running process.
 */
export function checkHealth(
  processes: readonly ProcessFact[],
  connected = true,
): readonly DoctorFinding[] {
  const gap = findingOf(
    'health',
    'note',
    'app.health',
    connected
      ? 'app.health and app.ready are not invoked per backend: only the core.process rows are judged (sections 13.12 and 16.9.7)'
      : 'health was not checked: doctor has no connection to a running deployment, so core.process, app.health and app.ready were not read (sections 13.12 and 16.9.7)',
    'run doctor against a connected deployment once the CLI connects (WP-58)',
  );
  if (!connected) return [gap];
  if (processes.length === 0) {
    return [
      findingOf(
        'health',
        'warning',
        'processes',
        'the control store lists no process',
        'start the deployment with keelwerk start',
      ),
      gap,
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
  return [...found, gap];
}
