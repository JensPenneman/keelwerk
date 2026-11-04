/**
 * The source of every random draw in the key service: a CSPRNG in production, a recorded or fixed
 * sequence in replay and tests (decision 77). Returns exactly `bytes` bytes.
 */
export type RandomSource = (bytes: number) => Uint8Array;
