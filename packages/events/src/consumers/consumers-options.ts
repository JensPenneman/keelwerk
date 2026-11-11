import type { ConsumerSpec, EventWorker, RuntimeServiceContext } from '@keelwerk/core';

/** What `consumers()` takes (section 15.2.3). */
export interface ConsumersOptions {
  /** A spec, or a builder called once at start (the dispatcher reads `context.apps`). Ids are unique. */
  readonly consumers: readonly (
    | ConsumerSpec
    | ((context: RuntimeServiceContext) => ConsumerSpec)
  )[];
  /** What the worker lifts at boot; default none. The reaction dispatcher passes `['asyncReactions']`. */
  readonly runs?: EventWorker['runs'];
  /** The lease length in milliseconds, renewed every third of it (D1); default 30,000, an integer of at least 3. */
  readonly leaseMs?: number;
  /** Events per scope batch (D3); default 100, an integer from 1 to 1,000. */
  readonly batchSize?: number;
}
