/**
 * How many reads of the flag rows may be outstanding in the cache at once. A read that timed out
 * keeps running in the adapter, so a further attempt waits until one of them settles.
 */
export const targetingMostOpenReads = 2;
