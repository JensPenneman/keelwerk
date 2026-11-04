import type { Id, SubjectId } from './id.ts';

/** Principal kinds (section 8.5). */
export type PrincipalKind = 'anonymous' | 'user' | 'service' | 'operator' | 'system';

/** What jobs and receipts store of a principal. */
export interface PrincipalRef {
  readonly resolver: string;
  readonly principalId: string;
  readonly credentialId: string | null;
}

/** A membership, from principal enrichers. */
export interface Membership {
  readonly kind: string;
  readonly id: string;
  readonly role: string;
}

/** What every principal carries. */
export interface PrincipalBase {
  readonly scope: { readonly backend: string | null; readonly tenant: string | null };
  readonly claims: Readonly<Record<string, unknown>>;
  readonly roles: readonly string[];
  readonly memberships: readonly Membership[];
  readonly via: string;
  readonly ref: PrincipalRef | null;
  readonly expiresAt?: Temporal.Instant;
  readonly apiVersion?: string;
}

/** A signed-in user. */
export interface UserPrincipal extends PrincipalBase {
  readonly kind: 'user';
  readonly subject: SubjectId;
  readonly subjectRef: string | null;
  subjectAs<R extends string>(ref: R): Id<R> | null;
}

/** A service principal (`auth.system`, a node, a webhook). */
export interface ServicePrincipal extends PrincipalBase {
  readonly kind: 'service';
  readonly id: string;
  idAs<R extends string>(ref: R): Id<R> | null;
}

/** An operator. */
export interface OperatorPrincipal extends PrincipalBase {
  readonly kind: 'operator';
  readonly id: string;
}

/** No principal. */
export interface AnonymousPrincipal extends PrincipalBase {
  readonly kind: 'anonymous';
}

/** The system principal of `invoke(..., { as: system(reason) })`. */
export interface SystemPrincipal extends PrincipalBase {
  readonly kind: 'system';
  readonly reason: string;
}

/** Any principal. */
export type Principal =
  | AnonymousPrincipal
  | UserPrincipal
  | ServicePrincipal
  | OperatorPrincipal
  | SystemPrincipal;

/** The principal narrowed by an action's or rule's `principal` option. */
export type PrincipalOf<Pk extends PrincipalKind> = Extract<Principal, { readonly kind: Pk }>;
