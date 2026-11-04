import type { WireError } from '../errors/wire-error.ts';

/**
 * What a receipt keeps of a command's result (section 15.1.7). `effects` lists the ids of the
 * deferred effects, so a replay returns the same ids.
 */
export type ReceiptOutcome =
  /** Entity commands: re-read and masked on replay. */
  | {
      readonly ok: true;
      readonly ref: { readonly entity: string; readonly id: string; readonly version: number };
      readonly effects: readonly string[];
    }
  /** Other commands: the serialised output. */
  | { readonly ok: true; readonly value: unknown; readonly effects: readonly string[] }
  | { readonly ok: false; readonly error: WireError };
