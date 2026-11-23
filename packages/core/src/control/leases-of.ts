import { errors } from '../errors/errors.ts';
import type { Unit } from '../storage/unit.ts';

/** The lease store of a deployment unit of the control namespace; `unsupported` when the adapter has none. */
export function leasesOf(unit: Unit): NonNullable<Unit['leases']> {
  if (unit.leases === undefined)
    throw errors.unsupported('The control adapter has no lease store.');
  return unit.leases;
}
