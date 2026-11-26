import type { Id } from '../ids/id.ts';
import type { PrincipalBase } from './principal-base.ts';
import type { PrincipalRef } from './principal-ref.ts';

/** A service principal (`auth.system`, a node, a webhook). */
export interface ServicePrincipal<Ref extends PrincipalRef = PrincipalRef>
  extends PrincipalBase<Ref> {
  readonly kind: 'service';
  /** 'auth.system', a node id for 'nodes.credential', 'github.webhook'. */
  readonly id: string;
  /** The entity the id refers to, 'nodes.node' for a node; the resolver answers it beside the id, and `idAs` is built from it. */
  readonly idRef?: string | null;
  /** The id as a branded row id when the principal stands for a row of `R`: the id when `ref` is `idRef`, else null. */
  idAs<R extends string>(ref: R): Id<R> | null;
}
