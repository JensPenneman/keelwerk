import { testPrincipal } from '@keelwerk/testing';

/** The subject of the first person of the tests, a 128-bit data subject. */
export const adaSubject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a21';
export const graceSubject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a22';

export const adaUser = testPrincipal(adaSubject);
export const graceUser = testPrincipal(graceSubject);
/** A user holding the role admin of the tenant they call in. */
export const adminAda = testPrincipal(adaSubject, { roles: ['admin'] });
export const ownerGrace = testPrincipal(graceSubject, { roles: ['owner'] });
