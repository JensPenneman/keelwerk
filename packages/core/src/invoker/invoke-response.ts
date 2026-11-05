import type { WireError } from '../errors/wire-error.ts';
import type { CommandReceipt } from './command-receipt.ts';

/** The JSON envelope of every invocation answer, success or error (section 16.8.2). */
export type InvokeResponse =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly commandId?: string;
      readonly receipt?: CommandReceipt;
      /** What `core.commandReceipt.get` reads the receipt by, for an accepted command whose receipt is in the session's own scope. */
      readonly receiptId?: string;
      readonly effects?: readonly string[];
    }
  | { readonly ok: false; readonly error: WireError };
