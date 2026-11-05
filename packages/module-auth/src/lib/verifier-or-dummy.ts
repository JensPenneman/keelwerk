import { dummyVerifier } from '@keelwerk/core';

/** The hash a password is checked against: the credential's, or for an unknown identifier a dummy of the same cost (17.2.2). */
export function verifierOrDummy(verifier: string | undefined): string {
  return verifier ?? dummyVerifier;
}
