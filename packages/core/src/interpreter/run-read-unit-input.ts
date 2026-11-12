import type { ActionEntry } from '../registry/action-entry.ts';
import type { RequestAuthorities } from './request-authorities.ts';
import type { RunReadInput } from './run-read-input.ts';

/** `RunReadInput` without the query, for the module of any action. */
export type RunReadUnitInput = Omit<RunReadInput, 'action' | 'input'> & {
  readonly action: ActionEntry;
  /** The authorities the requests were registered under; absent: a fresh map. */
  readonly authorities?: RequestAuthorities;
};
