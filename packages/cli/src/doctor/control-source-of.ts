import type { DataAdapter, NamespaceRef, Registry } from '@keelwerk/core';
import type { CliHost } from '../context/cli-host.ts';
import type { ControlSource } from './control-source.ts';
import { doctorReadBounds } from './doctor-read-bounds.ts';
import { unanswered } from './unanswered.ts';
import { withinDeadline } from './within-deadline.ts';

/**
 * The control store read through one adapter: every read is its own read-only deployment-scope
 * unit with the statement time limit of the bounds, and doctor waits for it no longer than the
 * deadline of the bounds. An entity is the descriptor the registry holds.
 */
export function controlSourceOf(
  adapter: DataAdapter,
  namespace: NamespaceRef,
  registry: Registry,
  schedule: CliHost['schedule'],
): ControlSource {
  const entity = (ref: string) => {
    const entry = registry.entities.get(ref);
    if (entry === undefined) throw new Error(`the registry has no entity ${ref}`);
    return entry.descriptor;
  };
  return {
    read: (fn) =>
      withinDeadline(
        schedule,
        adapter.unit(namespace, { level: 'deployment' }, (unit) => fn(unit, entity), {
          readOnly: true,
          timeoutMs: doctorReadBounds.unitTimeoutMs,
        }),
        unanswered,
      ),
  };
}
