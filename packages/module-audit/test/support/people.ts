import { testPrincipal } from '@keelwerk/testing';
import { foreignSubject, wordsOnlySubject } from './role-forger.ts';

/** The subject of the first person of the tests, a 128-bit data subject. */
export const adaSubject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a21';
export const graceSubject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a22';

export const adaUser = testPrincipal(adaSubject);
export const graceUser = testPrincipal(graceSubject);
/** A person who holds the words admin and owner and no membership. */
export const wordsOnly = testPrincipal(wordsOnlySubject);
/** The same person, with the words carried by the test principal instead of an enricher. */
export const wordsOfTheTest = testPrincipal(adaSubject, { roles: ['admin', 'owner'] });
/** A person with memberships of another module's kind, with the roles admin and owner. */
export const foreignStaff = testPrincipal(foreignSubject);
