import type { InvocationSession } from '@keelwerk/core';
import { fakeSession } from './fake-session.ts';

/** A session of a signed-in user with the given subject. */
export function userSession(
  subject: string,
  overrides: Partial<InvocationSession> = {},
): InvocationSession {
  return fakeSession({
    principal: {
      kind: 'user',
      subject,
      subjectRef: null,
      subjectAs: () => null,
      scope: { backend: 'b1', tenant: 't1' },
      claims: {},
      roles: [],
      memberships: [],
      via: 'test',
      ref: { resolver: 'test', principalId: subject },
    } as never,
    ...overrides,
  });
}
