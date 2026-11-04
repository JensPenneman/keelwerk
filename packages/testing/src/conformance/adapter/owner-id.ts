import { conformanceId } from '@keelwerk/data/conformance';

/** Owner number `n` has the id `conformanceId(100 + n)`. */
export const ownerId = (n: number): string => conformanceId(100 + n);
