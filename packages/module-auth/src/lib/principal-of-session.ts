import type { AnsweredPrincipal, Scope, SubjectId, UserPrincipal } from '@keelwerk/core';
import { sessionResolverId } from './session-resolver-id.ts';

const profileSubjectRef = 'accounts.profile';

/** What a session row says about the person it stands for. */
interface SessionFacts {
  readonly id: string;
  readonly subject: SubjectId;
  readonly credentialId: string;
  readonly idleExpiresAt: Temporal.Instant;
  readonly absoluteExpiresAt: Temporal.Instant;
}

/**
 * The user a live session stands for (17.2.4 step 3): the reference names the resolver, the session
 * and its credential, the subject reference is `accounts.profile` when the credential holds a
 * profile id (17.2.1), and the principal expires with the earlier of the two expiries.
 */
export function principalOfSession(
  row: SessionFacts,
  credential: object,
  scope: Scope,
): AnsweredPrincipal<UserPrincipal> {
  const profileId: string | undefined = Reflect.get(credential, 'profileId');
  // The reference carries the credential too, so a re-resolution can tell a reused session id apart.
  const ref = {
    resolver: sessionResolverId,
    principalId: row.id,
    credentialId: row.credentialId,
    sessionId: row.id,
  };
  return {
    kind: 'user',
    subject: row.subject,
    subjectRef: profileId === undefined ? null : profileSubjectRef,
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: {},
    roles: [],
    memberships: [],
    via: sessionResolverId,
    ref,
    expiresAt:
      Temporal.Instant.compare(row.idleExpiresAt, row.absoluteExpiresAt) < 0
        ? row.idleExpiresAt
        : row.absoluteExpiresAt,
  };
}
