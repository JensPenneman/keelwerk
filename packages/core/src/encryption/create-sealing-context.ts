import { errors } from '../errors/errors.ts';
import { defaultRandomSource } from '../keys/default-random-source.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { Unit } from '../storage/unit.ts';
import { createIndexKeys } from './index-keys.ts';
import { normalizerRegistry } from './normalizer-registry.ts';
import type { SealingContext } from './sealing-context.ts';
import type { SealingOptions } from './sealing-options.ts';

/** The sealing context of a raw unit: keys looked up once per unit, index keys derived on first use. */
export function createSealingContext(unit: Unit, options: SealingOptions): SealingContext {
  const current = new Map<string, Promise<DataKey>>();
  const byId = new Map<string, Promise<DataKey | undefined>>();
  return {
    unit,
    describe: (ref) => options.describe(unit.namespace, ref),
    normalizers: options.normalizers ?? normalizerRegistry(),
    indexKeys: createIndexKeys(options.keys, unit.scope),
    random: options.random ?? defaultRandomSource,
    maxScan: options.maxScan,
    dataKey: (subjectId) => {
      let key = current.get(subjectId);
      if (key === undefined) {
        key = unit.keys.dataKey(subjectId, { create: true }).then((found) => {
          if (found === undefined) {
            throw errors.forbidden(
              'The data subject was erased: personal values cannot be written.',
            );
          }
          return found;
        });
        current.set(subjectId, key);
        // A failed lookup is not remembered.
        key.catch(() => current.delete(subjectId));
      }
      return key;
    },
    keyById: (keyId) => {
      let key = byId.get(keyId);
      if (key === undefined) {
        key = unit.keys.keyById(keyId);
        byId.set(keyId, key);
        key.catch(() => byId.delete(keyId));
      }
      return key;
    },
  };
}
