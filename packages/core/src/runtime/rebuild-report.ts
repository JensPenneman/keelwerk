import type { RebuiltEntity } from '../replay/rebuilt-entity.ts';

export interface RebuildReport {
  readonly scopeId: string;
  /** In rebuild order; core.effect last. */
  readonly entities: readonly RebuiltEntity[];
  /** Jobs reenqueueUnsettledEffects enqueued again. */
  readonly enqueued: number;
}
