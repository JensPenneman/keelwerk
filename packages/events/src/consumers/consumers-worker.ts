import type { EventWorker, Position, StreamRef } from '@keelwerk/core';

/** The event worker `consumers()` builds, with what tests and the unpark command reach. */
export interface ConsumersWorker extends EventWorker {
  /** Waits for start, then every runner sweeps its namespace and passes until a pass commits no batch; answers the batches committed. */
  settled(): Promise<number>;
  /** `unparkStream` through the runner of the consumer in the namespace; `core.not_found` when none runs here. */
  unpark(
    consumer: string,
    namespaceId: string,
    scopeId: string,
    stream: StreamRef,
  ): Promise<Position | null>;
}
