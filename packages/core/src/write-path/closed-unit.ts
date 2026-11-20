import { errors } from '../errors/errors.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The unit a `perform` of `prepare` is handed: no unit is open while an inline effect runs, so
 * every member access throws.
 */
export const closedUnit: Unit = new Proxy({} as Unit, {
  get: () => {
    throw errors.internal('No unit is open while an inline effect runs.');
  },
});
