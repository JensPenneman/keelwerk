import type { DeploymentFacts } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/** External-table drift, dead letters, parked streams, capped lanes, unplaceable work and queues past 80 percent of a cap. */
export function workFindings(facts: DeploymentFacts): readonly DoctorFinding[] {
  const found: DoctorFinding[] = [];
  const check = 'deployment';
  const { work } = facts;
  for (const table of work.externalTableDrift) {
    found.push(
      findingOf(
        check,
        'error',
        table,
        'the external table differs from its mapping',
        'run keelwerk db plan and review the difference',
      ),
    );
  }
  if (work.deadLetters > 0) {
    found.push(
      findingOf(
        check,
        'warning',
        'dead letters',
        `${work.deadLetters} job(s) gave up and wait in the dead letters`,
        'inspect them with keelwerk introspect and retry or discard them',
      ),
    );
  }
  if (work.parkedStreams > 0) {
    found.push(
      findingOf(
        check,
        'warning',
        'parked streams',
        `${work.parkedStreams} stream(s) are parked`,
        'fix the cause of the failed consumer and resume the streams',
      ),
    );
  }
  if (work.cappedLanes > 0) {
    found.push(
      findingOf(
        check,
        'warning',
        'capped lanes',
        `${work.cappedLanes} lane(s) sit at their cap`,
        'raise the cap or add workers',
      ),
    );
  }
  if (work.unplaceable > 0) {
    found.push(
      findingOf(
        check,
        'error',
        'unplaceable work',
        `${work.unplaceable} job(s) need a capability no process declares`,
        'declare the capability on a process (section 21.2)',
      ),
    );
  }
  for (const queue of facts.queues) {
    if (queue.queuedCap !== undefined && queue.queued > queue.queuedCap * 0.8) {
      found.push(
        findingOf(
          check,
          'warning',
          queue.name,
          `queue ${queue.name} holds ${queue.queued} of ${queue.queuedCap} queued jobs (over 80 percent)`,
          `raise queues.${queue.name}.queued or drain the queue`,
        ),
      );
    }
  }
  return found;
}
