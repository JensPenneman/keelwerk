import { hkdfSync } from 'node:crypto';
import type { KeyService, SealingOptions } from '@keelwerk/core';
import { conformanceEntities } from '@keelwerk/data/conformance';
import type { ConformanceSubject } from './conformance-subject.ts';

/** Index root keys for the cases: a fixed secret, one root per scope. */
const rootSecret = new Uint8Array(32).fill(5);
const keys: Pick<KeyService, 'derive'> = {
  derive: async (forScope, info, length) =>
    new Uint8Array(hkdfSync('sha256', rootSecret, JSON.stringify(forScope), info, length)),
};

/** The sealing layer over the subject's adapter; `maxScan` overrides the adapter's bound. */
export function sealingOptionsOf(subject: ConformanceSubject, maxScan?: number): SealingOptions {
  return {
    keys,
    describe: (_namespace, ref) =>
      Object.values(conformanceEntities).find((entity) => entity.ref === ref),
    maxScan: maxScan ?? subject.capabilities().encryptedQueries.maxScan,
  };
}
