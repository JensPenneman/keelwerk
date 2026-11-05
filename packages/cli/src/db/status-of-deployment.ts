import { hostedApps } from './hosted-apps.ts';
import { namespaceOf } from './namespace-of.ts';
import type { NamespaceStatus } from './namespace-status.ts';
import type { OpenedDeployment } from './opened-deployment.ts';
import { tracksOfApp } from './tracks-of-app.ts';

/**
 * `db status` over a deployment (section 14.6.4): per placement and app, the history of the
 * namespace against the committed files. A namespace that was never provisioned has no history and
 * every file is pending.
 */
export async function statusOfDeployment(
  opened: OpenedDeployment,
): Promise<readonly NamespaceStatus[]> {
  const found: NamespaceStatus[] = [];
  for (const placement of opened.placements) {
    if (placement.dialect === 'memory') continue;
    for (const app of hostedApps(placement, opened.apps)) {
      const history = await placement.adapter.schema
        .history(namespaceOf(placement.name, app.id))
        .catch(() => []);
      const done = new Set(history.map((row) => `${row.track} ${row.id}`));
      const files = (await tracksOfApp(app)).flatMap((track) =>
        track.files.map((file) => `${track.track} ${file.id}`),
      );
      found.push({
        placement: placement.name,
        app: app.id,
        applied: history.map((row) => `${row.track} ${row.id}`),
        pending: files.filter((file) => !done.has(file)),
      });
    }
  }
  return found;
}
