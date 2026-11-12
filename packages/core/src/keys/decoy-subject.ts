/**
 * The subject of the decoy data key of a scope: a key no row refers to. An issued secret creates
 * it on its first use in the scope; a lookup with no row opens it where a found row opens its
 * sealed verifier, so the absent case unwraps and decrypts as much as the found one.
 */
export const decoySubject: string = '00000000-0000-4000-8000-00000000decc';
