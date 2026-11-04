import type { PrincipalKind } from './principal-kind.ts';

/** Who caused an event or a job: the actor of the envelope (section 15.1.3), `id` null for anonymous and kernel work. */
export interface ActorRef {
  readonly kind: PrincipalKind;
  readonly id: string | null;
  /** The resolver id of the principal. */
  readonly via: string;
}
