import type { SurfaceSource, TransportAdapter } from '@keelwerk/core';

/** The transport adapters the app's modules fill into `core.transports`. */
export function transportsOf(app: SurfaceSource): readonly TransportAdapter[] {
  return (app.registry.fills.get('core.transports') ?? []).flatMap((fill) =>
    fill.bound || typeof fill.fill !== 'object' || fill.fill === null
      ? []
      : [fill.fill as TransportAdapter],
  );
}
