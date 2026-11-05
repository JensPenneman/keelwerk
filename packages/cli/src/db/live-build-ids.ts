import type { SurfaceSource } from '@keelwerk/core';
import { presumedGoneAfterMs } from '@keelwerk/core';
import type { OpenedDeployment } from './opened-deployment.ts';

/**
 * The build ids of the live `core.process` rows of the control store (section 19.1): processes
 * that are neither stopped nor silent for 30 seconds or more. A row without an instant heartbeat counts as live, the same rule as the runtime's connect phase, since a gate that errs must err towards refusing. A control store that has never
 * been started has none.
 */
export async function liveBuildIds(
  opened: OpenedDeployment,
  app: SurfaceSource,
  now: number,
): Promise<readonly string[]> {
  if (opened.deploymentId === undefined) return [];
  const entity = app.registry.entities.get('core.process')?.descriptor;
  if (entity === undefined) return [];
  const page = await opened.control.adapter.unit(
    opened.control.namespace,
    { level: 'deployment' },
    (unit) => unit.rows.find(entity, {}),
    { readOnly: true },
  );
  return page.rows
    .filter((row) => {
      const beat = row.heartbeatAt;
      return (
        row.state !== 'stopped' &&
        (!(beat instanceof Temporal.Instant) || now - beat.epochMilliseconds < presumedGoneAfterMs)
      );
    })
    .map((row) => String(row.buildId));
}
