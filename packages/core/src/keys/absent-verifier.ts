/**
 * The verifier a resolver presents when the key a token names has no row. A verification against it
 * always fails. The kernel does the key-store work of a found row (two reads of key material and
 * one decryption, on a decoy key of the scope) before the comparison, so a lookup takes the same
 * calls and the same kind of work whether the key exists or not; the time is equal in kind, not
 * measured to be equal.
 */
export const absentVerifier: string = '0'.repeat(64);
