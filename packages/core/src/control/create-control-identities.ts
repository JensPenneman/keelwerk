import { errors } from '../errors/errors.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Unit } from '../storage/unit.ts';
import type { NamespaceIdentities } from './namespace-identities.ts';

function identitiesOf(unit: Unit): NonNullable<Unit['identities']> {
  if (unit.identities === undefined) {
    throw errors.unsupported('The control adapter has no namespace identities.');
  }
  return unit.identities;
}

/** `ControlStore.identities`: every call runs in its own deployment-scope unit of the control namespace. */
export function createControlIdentities(
  adapter: DataAdapter,
  namespace: NamespaceRef,
): NamespaceIdentities {
  return {
    all: () =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) => identitiesOf(unit).all(), {
        readOnly: true,
      }),
    record: (identity) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) =>
        identitiesOf(unit).record(identity),
      ),
  };
}
