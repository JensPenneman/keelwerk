/** The definition functions whose first argument is the base, or `within(base, declaration)` in a contribution or condition. */
export const partCallees: ReadonlySet<string> = new Set([
  'defineCommand',
  'defineFill',
  'defineProcess',
  'defineQuery',
  'defineReaction',
  'defineRule',
  'defineSubscription',
]);
