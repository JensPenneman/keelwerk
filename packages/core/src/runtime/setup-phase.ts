import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Registry } from '../registry/registry.ts';
import { deriveSurface } from '../surface/derive-surface.ts';
import type { TransportAdapter } from '../transport/transport-adapter.ts';
import type { DeployedApp } from './deployed-app.ts';
import type { ServedApp } from './served-app.ts';
import { servedRegistry } from './served-registry.ts';

function transportsOf(registry: Registry): readonly TransportAdapter[] {
  return (registry.fills.get('core.transports') ?? []).flatMap((fill) =>
    fill.bound || typeof fill.fill !== 'object' || fill.fill === null
      ? []
      : [fill.fill as TransportAdapter],
  );
}

/**
 * `setup` (section 3.3), before any adapter connects: each transport checks the app's surface at
 * its head version and any problem refuses the boot; the registry the invoker runs is prepared.
 * Module code does not run: modules only declare parts.
 */
export function setupPhase(apps: readonly DeployedApp[]): readonly ServedApp[] {
  return apps.map((app) => {
    const head = app.api?.dates.at(-1) ?? coreApiVersions.dates.at(-1) ?? '';
    const transports = transportsOf(app.registry);
    if (transports.length > 0) {
      const { surface } = deriveSurface(app, head);
      const problems = transports.flatMap((transport) => transport.check(surface));
      if (problems.length > 0) {
        throw new KeelwerkError({
          kind: 'internal',
          code: 'core.internal',
          message: `The transports of "${app.id}" cannot project its surface: ${problems.map((problem) => `${problem.transport} ${problem.code} ${problem.subject}`).join('; ')}`,
          details: { problems },
        });
      }
    }
    return { id: app.id, source: app, registry: servedRegistry(app.registry), head, transports };
  });
}
