import type {
  AnsweredPrincipal,
  PrincipalRef,
  Scope,
  SubjectId,
  UserPrincipal,
} from '@keelwerk/core';
import { keyResolverId } from './key-resolver-id.ts';

/** What the principal of a key is built from: the row's members the principal carries. */
interface KeyRowFacts {
  readonly id: string;
  readonly subject: SubjectId;
  readonly subjectRef?: string | undefined;
  readonly scopes: readonly string[];
  readonly expiresAt?: Temporal.Instant | undefined;
}

/**
 * The principal a key stands for (8.5): a user whose subject is the key's owner, resolved by this
 * module, with the key's scopes as claims. `apiVersion` is the pin the request is served at.
 */
export function keyPrincipal(
  row: KeyRowFacts,
  scope: Scope,
  apiVersion: string | undefined,
): AnsweredPrincipal<UserPrincipal> {
  const subjectRef = row.subjectRef ?? null;
  const ref: PrincipalRef & { readonly keyId: string } = {
    resolver: keyResolverId,
    principalId: row.id,
    keyId: row.id,
  };
  return {
    kind: 'user',
    subject: row.subject,
    subjectRef,
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: { scopes: row.scopes },
    roles: [],
    memberships: [],
    via: keyResolverId,
    ref,
    ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
    ...(apiVersion === undefined ? {} : { apiVersion }),
  };
}
