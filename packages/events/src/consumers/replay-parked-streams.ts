import type { ConsumerSpec, Logger, QueueSource, ScopeTarget, Unit } from '@keelwerk/core';
import { unparkStream } from './unpark-stream.ts';

/** What the replay of a consumer's parked streams is run with. */
export interface ReplayParkedInput {
  readonly spec: ConsumerSpec;
  readonly source: QueueSource;
  readonly batchSize: number;
  /** The per-`consume` deadline of a replay, in real milliseconds. */
  readonly deadlineMs: number;
  readonly log: Logger;
  /** Lists the work a replay deadline abandoned until it settles. */
  readonly abandoned?: Set<Promise<unknown>>;
  /** False once the runner stops or loses its lease (renewed when due); no further row is replayed. */
  readonly proceed: () => Promise<boolean>;
  /** The scope of a scope id, `undefined` when the namespace cannot place it. */
  readonly targetOf: (scopeId: string) => Promise<ScopeTarget | undefined>;
  readonly inNamespace: <T>(work: (unit: Unit) => Promise<T>) => Promise<T>;
}

/**
 * Every parked stream of the consumer is replayed at an acquisition (D5). A stream that fails again
 * is logged and stays parked; it never stops the replay of the others. The replay ends at once when
 * the runner stops or loses its lease. Answers whether every row was dealt with, so the caller
 * replays again at its next pass when the replay was cut short.
 */
export async function replayParkedStreams(input: ReplayParkedInput): Promise<boolean> {
  const { spec, batchSize, deadlineMs, log, abandoned } = input;
  const rows = await input.inNamespace((unit) => unit.consumers.parked(spec.id));
  for (const row of rows) {
    if (!(await input.proceed())) return false;
    try {
      const target = await input.targetOf(row.scopeId);
      if (target === undefined) continue;
      await unparkStream({
        spec,
        target,
        scopeId: row.scopeId,
        stream: row.stream,
        batchSize,
        deadlineMs,
        log,
        ...(abandoned === undefined ? {} : { abandoned }),
        proceed: input.proceed,
      });
    } catch (error) {
      log.warn('a parked stream was replayed at the acquisition and failed again', {
        consumer: spec.id,
        scope: row.scopeId,
        stream: row.stream,
        cause: error,
      });
    }
  }
  return true;
}
