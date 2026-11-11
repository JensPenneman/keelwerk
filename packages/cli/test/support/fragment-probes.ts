import type { ApiSurface, Artifact, TransportAdapter } from '@keelwerk/core';
import type { AppDerivation } from '../../src/producers/app-derivation.ts';

/** The `type-fragment` branch of the artefacts a transport answers. */
export type Fragment = Extract<Artifact, { kind: 'type-fragment' }>;

/** The app with its `core.transports` fill replaced by `transports`. */
export function withTransports(
  app: AppDerivation,
  transports: readonly TransportAdapter[],
): AppDerivation {
  const fills = new Map(app.app.registry.fills);
  fills.set('core.transports', transports.map((fill) => ({ fill, bound: false })) as never);
  return { ...app, app: { ...app.app, registry: { ...app.app.registry, fills } } };
}

/** A transport that checks clean, answers `fragmentsAt` and cannot be mounted. */
export function fragmentProbe(
  name: string,
  fragmentsAt: (surface: ApiSurface) => Artifact[],
): TransportAdapter {
  return {
    name,
    capabilities: { streaming: [], batching: false, binary: false },
    static: {},
    check: () => [],
    artifacts: fragmentsAt,
    mount: async () => {
      throw new Error('not mounted');
    },
  };
}

/** The derived app with this id; the fixture apps of the repository carry theirs. */
export function appById(apps: readonly AppDerivation[], id: string): AppDerivation {
  const found = apps.find((app) => app.app.id === id);
  if (found === undefined) throw new Error(`the ${id} fixture app was not found`);
  return found;
}
