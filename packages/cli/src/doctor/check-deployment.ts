import type { DeploymentFacts } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';
import { hookFailureFindings } from './hook-failure-findings.ts';
import { sqlNeedsFindings } from './sql-needs-findings.ts';
import { workFindings } from './work-findings.ts';

/**
 * The deployment (section 13.12): operator socket permissions, master key, control store
 * reachable, the control store on another cluster than the placements or a ledger sink
 * configured (section 14.7.6), stuck work, failed tenant hooks and raw-SQL needs.
 */
export function checkDeployment(facts: DeploymentFacts): readonly DoctorFinding[] {
  const found: DoctorFinding[] = [];
  const check = 'deployment';
  const { socket } = facts;
  if (socket !== undefined && socket.mode !== undefined && (socket.mode & 0o077) !== 0) {
    found.push(
      findingOf(
        check,
        'error',
        socket.path,
        `the operator socket has mode ${(socket.mode & 0o777).toString(8).padStart(3, '0')}, so other users can reach it`,
        `chmod 600 ${socket.path}`,
      ),
    );
  }
  if (!facts.masterKey.declared) {
    found.push(
      findingOf(
        check,
        'error',
        'keys.masterKey',
        'the deployment declares no master key',
        'set keys.masterKey to a secret reference',
      ),
    );
  } else if (!facts.masterKey.present) {
    found.push(
      findingOf(
        check,
        'error',
        'keys.masterKey',
        'the master key secret is not available to this process',
        'provide the secret to the environment or a secret provider',
      ),
    );
  }
  if (facts.controlReachable !== undefined && !facts.controlReachable.reachable) {
    found.push(
      findingOf(
        check,
        'error',
        'control store',
        `the control store is not reachable: ${facts.controlReachable.detail}`,
        'check the control adapter and its url',
      ),
    );
  }
  const shared = facts.placements.filter(
    (placement) => placement.cluster !== undefined && placement.cluster === facts.control.cluster,
  );
  if (shared.length > 0 && facts.ledgerSinks === 0) {
    found.push(
      findingOf(
        check,
        'warning',
        'control store',
        `the control store shares a cluster with ${shared.map((placement) => placement.name).join(', ')} and no ledger sink is configured, so a restored backup cannot be detected`,
        'move the control store to another cluster or list a ledger sink in the infrastructure (section 14.7.6)',
      ),
    );
  }
  return [
    ...found,
    ...workFindings(facts),
    ...hookFailureFindings(facts),
    ...sqlNeedsFindings(facts),
  ];
}
