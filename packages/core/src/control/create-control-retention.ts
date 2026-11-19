import { errors } from '../errors/errors.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { RetentionRunStore } from '../storage/retention-run-store.ts';
import type { Unit } from '../storage/unit.ts';
import type { ControlRetention } from './control-retention.ts';

function storeOf(unit: Unit): RetentionRunStore {
  if (unit.retentionRuns === undefined) {
    throw errors.unsupported('The control adapter has no retention run store.');
  }
  return unit.retentionRuns;
}

/** `ControlStore.retention`: every call runs in its own deployment-scope unit of the control namespace. */
export function createControlRetention(
  adapter: DataAdapter,
  namespace: NamespaceRef,
): ControlRetention {
  return {
    record: async (run) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) => storeOf(unit).append(run)),
    list: async (query) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) => storeOf(unit).list(query), {
        readOnly: true,
      }),
  };
}
