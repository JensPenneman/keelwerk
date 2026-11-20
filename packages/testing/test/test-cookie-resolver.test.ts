import { describe, expect, it } from 'vitest';
import { testCookieName } from '../src/conformance/transport/test-cookie-name.ts';
import { testCookieResolver } from '../src/conformance/transport/test-cookie-resolver.ts';
import type { TestPrincipalBook } from '../src/harness/test-principal-book.ts';

function resolved(value: string, book?: TestPrincipalBook) {
  const carrier = { headers: { cookie: `${testCookieName}=${value}` } };
  const context = { scope: { level: 'deployment' } };
  const run = testCookieResolver(book).resolve(carrier as never, context as never);
  const step = run.next();
  if (step.done !== true) throw new Error('The cookie resolver asked for something.');
  return step.value;
}

describe('testCookieResolver', () => {
  it('user:<subject> is that user holding no roles', () => {
    const answer = resolved('user:ada');
    expect(answer?.principal).toMatchObject({ kind: 'user', subject: 'ada', roles: [] });
    expect(answer?.clearCookies).toBeUndefined();
  });

  it('the role form user+<role>+<role>:<subject> is that user holding those roles', () => {
    const answer = resolved('user+auditor+reader:ada');
    expect(answer?.principal).toMatchObject({
      kind: 'user',
      subject: 'ada',
      roles: ['auditor', 'reader'],
      ref: { resolver: 'test.cookie', principalId: 'ada' },
    });
    expect(resolved('user+auditor:ada')?.principal).toMatchObject({ roles: ['auditor'] });
  });

  it('a subject keeps a colon in either form', () => {
    expect(resolved('user:a:b')?.principal).toMatchObject({ subject: 'a:b', roles: [] });
    expect(resolved('user+auditor:a:b')?.principal).toMatchObject({
      subject: 'a:b',
      roles: ['auditor'],
    });
  });

  it('a revoked subject, in either form, is anonymous without roles and the cookie is cleared', () => {
    const book: TestPrincipalBook = { seen: new Map(), revoked: new Set(['ada']) };
    for (const value of ['user:ada', 'user+auditor:ada']) {
      const answer = resolved(value, book);
      expect(answer?.principal).toMatchObject({ kind: 'anonymous', roles: [], ref: null });
      expect(answer?.clearCookies).toEqual([testCookieName]);
    }
  });

  it('any other value is a stale session: anonymous with the cookie cleared', () => {
    for (const value of ['ada', 'user+:ada', 'admin+auditor:ada']) {
      const answer = resolved(value);
      expect(answer?.principal).toMatchObject({ kind: 'anonymous', roles: [] });
      expect(answer?.clearCookies).toEqual([testCookieName]);
    }
  });
});
