/** The outcome of an effect, answered as a value, never thrown into a generator (section 7.9.3). */
export type EffectOutcome<O> =
  | { readonly ok: true; readonly value: O }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
