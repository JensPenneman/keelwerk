/** The outcome every transport must produce for the same call. */
export type Decoded =
  | {
      readonly ok: true;
      /** The decoded value; for an accepted command the receipt. */
      readonly value: unknown;
      /** The command ran asynchronously and answered a receipt (202). */
      readonly accepted: boolean;
    }
  | { readonly ok: false; readonly kind: string; readonly code: string };
