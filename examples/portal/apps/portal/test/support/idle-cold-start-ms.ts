/**
 * What the session waits for is the first, cold cycle of `keelwerk dev` in a new scratch root: the
 * probe with new database directories and every migration, then the boot of the app, up to the line
 * `app running at`. A cold start takes about five seconds idle; the worst slowdown measured is ten
 * times (lead decision S-108) and whole-suite runs showed more.
 */
export const idleColdStartMs = 5_000;
