import { errors, type PrincipalResolver } from '@keelwerk/core';
import type { TestPrincipalBook } from '../../harness/test-principal-book.ts';
import { testPrincipalHeader } from '../../harness/test-principal-header.ts';

function headerSubject(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  try {
    const held: unknown = JSON.parse(text);
    const subject: unknown =
      typeof held === 'object' && held !== null ? Reflect.get(held, 'subject') : undefined;
    return typeof subject === 'string' ? subject : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The resolver that makes a revoked subject's key fail: a carrier whose test principal header names
 * a subject the test revoked is `unauthenticated`, as a revoked bearer key is, so that opening the
 * session again (a socket's session check, a subscription) fails. A revoked cookie session does not
 * fail: the test cookie resolver answers it as a stale session, anonymous with the cookie cleared,
 * as the auth module's resolver does. Any other carrier is left to the next resolver.
 */
export function testRevocationResolver(book: TestPrincipalBook): PrincipalResolver {
  return {
    id: 'test.revocation',
    describe: () => ({ scheme: 'apiKey', name: testPrincipalHeader }),
    // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
    *resolve(carrier) {
      const subject = headerSubject(carrier.headers?.[testPrincipalHeader]);
      if (subject !== undefined && book.revoked.has(subject)) {
        throw errors.unauthenticated('The credential was revoked.');
      }
      return null;
    },
  };
}
