import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { CommandReceipt } from './command-receipt.ts';

/** The result of an invocation or of opening a session; narrow on `ok`. */
export type Outcome<O> =
  | {
      readonly ok: true;
      readonly value: O;
      readonly receipt?: CommandReceipt;
      /** Ids of the deferred effects (section 7.9.5). */
      readonly effects?: readonly string[];
      /** Set by the invoker on an idempotent replay (section 16.4.8). */
      readonly replayed?: true;
      /** The id `core.commandReceipt.get` reads an accepted command's receipt by; set only when the receipt is in the session's own scope (S-102). */
      readonly receiptId?: string;
    }
  | { readonly ok: false; readonly error: KeelwerkError };
