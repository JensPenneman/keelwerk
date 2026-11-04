import type { Id } from '../ids/id.ts';
import type { SubjectId } from '../ids/subject-id.ts';
import type { PrincipalBase } from './principal-base.ts';
import type { PrincipalRef } from './principal-ref.ts';

/** A signed-in user. */
export interface UserPrincipal<Ref extends PrincipalRef = PrincipalRef> extends PrincipalBase<Ref> {
  readonly kind: 'user';
  /** Never null for a user. */
  readonly subject: SubjectId;
  /** The entity subjects refer to: 'accounts.profile' when accounts is selected. */
  readonly subjectRef: string | null;
  /** Null when the subject is not a row of `R`; null never matches. */
  subjectAs<R extends string>(ref: R): Id<R> | null;
}
