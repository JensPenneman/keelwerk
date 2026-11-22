/** The pause after the first failure, in milliseconds; each further failure in a row doubles it. */
const baseMs = 1000;
/** The longest pause before the jitter. */
const ceilingMs = 10_000;
/** The jitter is a factor between `1 - spread` and `1 + spread`. */
const spread = 0.2;

/**
 * The one policy by which a background loop tries again after a failure (14.3.7, 9.5.6): `baseMs`
 * doubled for each failure in a row (`failures` is 1 after the first; 0 gives the same pause, the
 * poll of a loop that has not failed), at most `ceilingMs`, times a factor drawn from `random`
 * between 0.8 and 1.2, so that the loops of many processes do not ask a recovering server in step.
 * A loop counts its failures itself and starts again at 1 after a success. Never zero, so no loop
 * spins.
 */
export function backgroundRetryMs(failures: number, random: () => number = Math.random): number {
  const doubled = baseMs * 2 ** Math.max(0, failures - 1);
  return Math.round(Math.min(doubled, ceilingMs) * (1 - spread + 2 * spread * random()));
}
