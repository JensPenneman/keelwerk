import type { Id } from '../ids/id.ts';
import type { PrincipalBase } from './principal-base.ts';
import type { PrincipalRef } from './principal-ref.ts';

/** A service principal (`auth.system`, a node, a webhook). */
export interface ServicePrincipal<Ref extends PrincipalRef = PrincipalRef>
  extends PrincipalBase<Ref> {
  readonly kind: 'service';
  /** 'auth.system', a node id for 'nodes.credential', 'github.webhook'. */
  readonly id: string;
  /** The id as a branded row id when the principal stands for a row of `R`. */
  idAs<R extends string>(ref: R): Id<R> | null;
}
