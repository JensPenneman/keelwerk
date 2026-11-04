import type { WireError } from '../errors/wire-error.ts';
import type { CommandReceipt } from './command-receipt.ts';

/** The JSON envelope of every invocation answer, success or error (section 16.8.2). */
export type InvokeResponse =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly receipt?: CommandReceipt;
      readonly effects?: readonly string[];
    }
  | { readonly ok: false; readonly error: WireError };
