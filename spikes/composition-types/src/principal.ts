import type { Id, SubjectId } from './id.ts';

/** Principal kinds (section 8.5). */
export type PrincipalKind = 'anonymous' | 'user' | 'service' | 'operator' | 'system';

/**
 * What jobs and receipts store of a principal: the resolver and the principal id; the module that
 * resolves the principal adds its own typed fields (`principalRef` on its base, section 8.5).
 */
export interface PrincipalRef {
  readonly resolver: string;
  readonly principalId: string;
}

/** A membership, from principal enrichers. */
export interface Membership {
  readonly kind: string;
  readonly id: string;
  readonly role: string;
}

/** What every principal carries; `Ref` is the reference as the module whose part runs types it. */
export interface PrincipalBase<Ref extends PrincipalRef = PrincipalRef> {
  readonly scope: { readonly backend: string | null; readonly tenant: string | null };
  readonly claims: Readonly<Record<string, unknown>>;
  readonly roles: readonly string[];
  readonly memberships: readonly Membership[];
  readonly via: string;
  readonly ref: Ref | null;
  readonly expiresAt?: Temporal.Instant;
  readonly apiVersion?: string;
}

/** A signed-in user. */
export interface UserPrincipal<Ref extends PrincipalRef = PrincipalRef> extends PrincipalBase<Ref> {
  readonly kind: 'user';
  readonly subject: SubjectId;
  readonly subjectRef: string | null;
  subjectAs<R extends string>(ref: R): Id<R> | null;
}

/** A service principal (`auth.system`, a node, a webhook). */
export interface ServicePrincipal<Ref extends PrincipalRef = PrincipalRef>
  extends PrincipalBase<Ref> {
  readonly kind: 'service';
  readonly id: string;
  idAs<R extends string>(ref: R): Id<R> | null;
}

/** An operator. */
export interface OperatorPrincipal<Ref extends PrincipalRef = PrincipalRef>
  extends PrincipalBase<Ref> {
  readonly kind: 'operator';
  readonly id: string;
}

/** No principal. */
export interface AnonymousPrincipal<Ref extends PrincipalRef = PrincipalRef>
  extends PrincipalBase<Ref> {
  readonly kind: 'anonymous';
}

/** The system principal of `invoke(..., { as: system(reason) })`. */
export interface SystemPrincipal<Ref extends PrincipalRef = PrincipalRef>
  extends PrincipalBase<Ref> {
  readonly kind: 'system';
  readonly reason: string;
}

/** Any principal. */
export type Principal<Ref extends PrincipalRef = PrincipalRef> =
  | AnonymousPrincipal<Ref>
  | UserPrincipal<Ref>
  | ServicePrincipal<Ref>
  | OperatorPrincipal<Ref>
  | SystemPrincipal<Ref>;

/** The principal narrowed by an action's or rule's `principal` option. */
export type PrincipalOf<
  Pk extends PrincipalKind,
  Ref extends PrincipalRef = PrincipalRef,
> = Extract<Principal<Ref>, { readonly kind: Pk }>;
