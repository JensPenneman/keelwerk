import type { Unit } from '../storage/unit.ts';
import type { PersonalSealer } from './personal-sealer.ts';
import { personalSealerKey } from './personal-sealer-key.ts';

/** The sealer of a sealing unit; `undefined` for a unit the sealing layer does not wrap. */
export function personalSealerOf(unit: Unit): PersonalSealer | undefined {
  const sealer: unknown = Reflect.get(unit, personalSealerKey);
  return sealer === undefined ? undefined : (sealer as PersonalSealer);
}
