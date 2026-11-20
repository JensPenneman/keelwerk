/** Who holds the draws, and the source the first holder found. */
const held: { holders: number; source: (() => number) | undefined } = {
  holders: 0,
  source: undefined,
};

/** The largest draw below 1 that `0.5 + source() / 2` can reach without rounding up to 1. */
const highestDraw = 1 - Number.EPSILON / 2;

/**
 * Keeps every draw of `Math.random` in [0.5, 1) while at least one holder holds it. A job delay
 * `floor(draw * (delay + 1))` (retry-delay.ts) then lies between half and the whole of the policy's
 * delay and is never zero for a delay of at least 1 ms, while the draws still differ. Unit retries
 * (retry-unit.ts) wait 1 to 2, 2 to 4 and 4 to 8 ms. The first holder wraps the source it finds with
 * `0.5 + source() / 2`, clamped below 1: that formula rounds the largest draw below 1 to exactly 1,
 * which would give a delay of `delay + 1`. The last release puts that source back. The release it
 * answers acts once.
 */
export function holdUpperDraws(): () => void {
  if (held.holders === 0) {
    const source = Math.random;
    held.source = source;
    Math.random = () => Math.min(0.5 + source() / 2, highestDraw);
  }
  held.holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.holders -= 1;
    if (held.holders === 0 && held.source !== undefined) {
      Math.random = held.source;
      held.source = undefined;
    }
  };
}
