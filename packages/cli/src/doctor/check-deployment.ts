import { defineCheck } from './define-check.ts';
import type { DeploymentCheck } from './deployment-check.ts';
import { findingOf } from './finding-of.ts';
import { hookFailureFindings } from './hook-failure-findings.ts';

const group = 'deployment';

/**
 * The deployment (section 13.12): operator socket permissions, master key, control store
 * reachable, the control store on another cluster than the placements or a ledger sink
 * configured (section 14.7.6), and failed tenant hooks.
 */
export const deploymentGroup: readonly DeploymentCheck[] = [
  defineCheck({
    group,
    name: 'operator socket mode',
    needs: ['socket'],
    judge: ({ socket }) =>
      socket !== null && (socket.mode & 0o077) !== 0
        ? [
            findingOf(
              group,
              'error',
              socket.path,
              `the operator socket has mode ${(socket.mode & 0o777).toString(8).padStart(3, '0')}, so other users can reach it`,
              `chmod 600 ${socket.path}`,
            ),
          ]
        : [],
  }),
  defineCheck({
    group,
    name: 'master key',
    needs: ['masterKey'],
    judge: ({ masterKey }) => {
      if (!masterKey.declared) {
        return [
          findingOf(
            group,
            'error',
            'keys.masterKey',
            'the deployment declares no master key',
            'set keys.masterKey to a secret reference',
          ),
        ];
      }
      return masterKey.present
        ? []
        : [
            findingOf(
              group,
              'error',
              'keys.masterKey',
              'the master key secret is not available to this process',
              'provide the secret to the environment or a secret provider',
            ),
          ];
    },
  }),
  defineCheck({
    group,
    name: 'control store reachable',
    needs: ['controlReachable'],
    judge: ({ controlReachable }) =>
      controlReachable.reachable
        ? []
        : [
            findingOf(
              group,
              'error',
              'control store',
              `the control store is not reachable: ${controlReachable.detail}`,
              'check the control adapter and its url',
            ),
          ],
  }),
  defineCheck({
    group,
    name: 'control store shares a cluster',
    needs: ['clusters', 'ledgerSinks'],
    judge: ({ clusters, ledgerSinks }) => {
      const shared = clusters.placements.filter(
        (placement) => placement.cluster === clusters.control,
      );
      return shared.length > 0 && ledgerSinks === 0
        ? [
            findingOf(
              group,
              'warning',
              'control store',
              `the control store shares a cluster with ${shared.map((placement) => placement.name).join(', ')} and no ledger sink is configured, so a restored backup cannot be detected`,
              'move the control store to another cluster or list a ledger sink in the infrastructure (section 14.7.6)',
            ),
          ]
        : [];
    },
  }),
  defineCheck({
    group,
    name: 'failed tenant hooks',
    needs: ['hookFailures'],
    judge: ({ hookFailures }) => hookFailureFindings(hookFailures),
  }),
];
