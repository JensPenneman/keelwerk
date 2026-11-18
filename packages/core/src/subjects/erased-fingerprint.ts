/**
 * The fingerprint an erasure leaves on a receipt it keeps (14.7.5, step 5a): never 64 hexadecimal
 * characters, so no input matches it, and a retry of the command with the same id meets
 * `core.idempotency_mismatch` instead of running again.
 */
export const erasedFingerprint = 'erased';
