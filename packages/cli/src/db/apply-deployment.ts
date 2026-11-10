import { KeelwerkError } from '@keelwerk/core';
import { applyPending } from '@keelwerk/data';
import { localFailure } from '../context/local-failure.ts';
import { buildIdOf } from './build-id-of.ts';
import { hostedApps } from './hosted-apps.ts';
import { jobGroupsOf } from './job-groups-of.ts';
import { liveBuildIds } from './live-build-ids.ts';
import { namespaceOf } from './namespace-of.ts';
import type { NamespaceOutcome } from './namespace-outcome.ts';
import type { OpenedDeployment } from './opened-deployment.ts';
import { tracksOfApp } from './tracks-of-app.ts';

/**
 * `db apply` over a deployment (section 14.6.4): for every placement and the apps it hosts, creates
 * the framework tables when they are missing and applies the pending migration files in run order.
 * Files with contract steps wait unless `contract` is set and every live process runs this build
 * (S-44). A placement with the in-memory adapter has no schema to apply to and is skipped.
 */
export async function applyDeployment(
  opened: OpenedDeployment,
  options: {
    readonly contract: boolean;
    readonly now: number;
    /** Called with what was just finished, after the schema and after the migrations of each placement and app. */
    readonly progress?: (done: string) => void;
  },
): Promise<readonly NamespaceOutcome[]> {
  const outcomes: NamespaceOutcome[] = [];
  const buildId = options.contract ? await buildIdOf(opened.apps) : '';
  for (const placement of opened.placements) {
    if (placement.dialect === 'memory') continue;
    for (const app of hostedApps(placement, opened.apps)) {
      const namespace = namespaceOf(placement.name, app.id);
      const tracks = (await tracksOfApp(app)).filter((track) => track.files.length > 0);
      const warnings: string[] = [];
      await placement.adapter.schema.provision(namespace, [], {
        jobGroups: jobGroupsOf(opened.definition),
      });
      options.progress?.(`provisioned the schema of ${placement.name}/${app.id}`);
      try {
        const result = await applyPending(
          placement.adapter.schema,
          namespace,
          tracks.map((track) => ({ track: track.track, files: track.files })),
          {
            warn: (message) => warnings.push(message),
            ...(options.contract
              ? {
                  contract: {
                    buildId,
                    liveBuildIds: () => liveBuildIds(opened, app, options.now),
                  },
                }
              : {}),
          },
        );
        options.progress?.(`applied the migrations of ${placement.name}/${app.id}`);
        outcomes.push({
          placement: placement.name,
          app: app.id,
          applied: result.applied.map((item) => `${item.track} ${item.id}`),
          deferred: result.deferred.map((item) => `${item.track} ${item.id}`),
          warnings,
        });
      } catch (error) {
        const message = `${placement.name}/${app.id}: ${error instanceof Error ? error.message : String(error)}`;
        throw error instanceof KeelwerkError
          ? localFailure(error.kind, error.code, message)
          : localFailure('internal', 'cli.migration_failed', message);
      }
    }
  }
  return outcomes;
}
