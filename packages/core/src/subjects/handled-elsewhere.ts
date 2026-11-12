/** Entities that are erased by their own step or never hold the subject's values in a row: the effect record and the receipt. */
export const handledElsewhere: ReadonlySet<string> = new Set([
  'core.effect',
  'core.commandReceipt',
]);
