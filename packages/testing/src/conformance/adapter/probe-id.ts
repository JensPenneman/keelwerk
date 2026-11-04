import { conformanceId } from '@keelwerk/data/conformance';

/** Probe number `n` has the id `conformanceId(200 + n)`. */
export const probeId = (n: number): string => conformanceId(200 + n);
