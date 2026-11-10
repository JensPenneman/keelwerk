/**
 * The step limit of section 13.6: the longest the probe may stay silent while no project module
 * import is in flight, that is while it does its own work (producers, migration checks, opening
 * and applying the development database). Silence there means a slow machine or database, not a
 * definition file, so the limit is far above the import limit.
 */
export const probeStepLimitMs = 60_000;
