/**
 * A stand-in for the principal context of a rule callback: every member, call and result is the
 * same inert value, so a callback can be run once to see which fields its condition names.
 */
export function probeContext(): unknown {
  return new Proxy(() => undefined, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => '' : probeContext()),
    apply: () => probeContext(),
  });
}
