import { errors } from '../errors/errors.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Unit } from '../storage/unit.ts';
import type { ControlLedger } from './control-ledger.ts';

function ledgerOf(unit: Unit): NonNullable<Unit['ledger']> {
  if (unit.ledger === undefined) {
    throw errors.unsupported('The control adapter has no ledger store.');
  }
  return unit.ledger;
}

/**
 * `ControlStore.ledger`: every call runs in its own deployment-scope unit of the control namespace
 * (a writing one for `append`, a read-only one for the reads). Anchors stay in the sinks, so `append`
 * refuses one.
 */
export function createControlLedger(adapter: DataAdapter, namespace: NamespaceRef): ControlLedger {
  return {
    append: async (record) => {
      if (record.type === 'anchor') {
        throw errors.internal('The control ledger holds erasure and key tombstone records only.');
      }
      return adapter.unit(namespace, { level: 'deployment' }, (unit) =>
        ledgerOf(unit).append(record),
      );
    },
    since: async (seq, limit) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) => ledgerOf(unit).since(seq, limit), {
        readOnly: true,
      }),
    find: async (lookups, page) =>
      adapter.unit(
        namespace,
        { level: 'deployment' },
        (unit) => ledgerOf(unit).find(lookups, page),
        {
          readOnly: true,
        },
      ),
    unfinished: async (query) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) => ledgerOf(unit).unfinished(query), {
        readOnly: true,
      }),
  };
}
