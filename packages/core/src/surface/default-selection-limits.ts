import type { SelectionLimits } from './selection-limits.ts';

/** The limits of 16.6.6, used until a backend configures its own. */
export const defaultSelectionLimits: SelectionLimits = Object.freeze({
  noRepeatedEntity: true,
  depth: 12,
  aliases: 30,
  operations: 20,
  tokens: 5000,
  cost: 1000,
});
