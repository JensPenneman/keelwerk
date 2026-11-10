/**
 * The import limit of section 13.6: the longest the probe may stay silent while a project module
 * import is in flight. A definition file that stays silent that long does I/O at import time.
 */
export const probeLimitMs = 10_000;
