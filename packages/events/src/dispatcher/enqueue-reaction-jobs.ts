import type {
  AsyncReactionEvent,
  JobQueue,
  Logger,
  ReactionEntry,
  Registry,
  StoredEvent,
  Unit,
} from '@keelwerk/core';
import {
  asyncReactionEventOf,
  isProcessStream,
  processJobInstance,
  reactionJob,
  reactionKeyError,
  reactionMatches,
  reactionsInModuleOrder,
} from '@keelwerk/core';

/** Whether the reaction's key is the queue's: only an ordered, coalescing or process reaction groups by it. */
function usesKey(reaction: ReactionEntry): boolean {
  return reaction.key !== undefined && (reaction.ordering === 'fifo-per-key' || reaction.coalesce);
}

/** What the reaction jobs of one batch are built from. */
export interface EnqueueReactionJobsInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly events: readonly StoredEvent[];
  readonly queue: JobQueue;
  /** Where a reaction whose key failed is logged (its id and the error code only). */
  readonly log: Logger;
  readonly build: { readonly id: string; readonly revision: number };
  readonly now: Temporal.Instant;
}

/**
 * The dispatch of one batch, in the unit of the events' scope (7.7): for each event in order
 * (transient records and the events of a process's own stream are skipped: they are no business
 * events, and no reaction receives them), and for each async reaction in module order that listens
 * to it, one keyed job on the `reactions` queue. The declared key is computed here from the event
 * as the reaction sees it, `current` read in this unit under the reaction's module, once per event
 * and module. A process's key is computed here once, from the event without `current`; the job
 * carries the derived stream id (and, for a process with a data subject, the sealed subject), and
 * the run folds that stream: it never computes the key again. A key that throws, is not text or is
 * empty, and the instance key of a process with personal members that is no UUID, make that reaction's job alone a job that fails when it runs
 * (a dead letter of that reaction): the other reactions' jobs and the checkpoint commit as usual,
 * so one module's fault never holds an event back from another. Answers the number of jobs
 * enqueued. The unit is the batch's, so the jobs and the checkpoint advance commit together;
 * nothing but `key` runs module code.
 */
export async function enqueueReactionJobs(input: EnqueueReactionJobsInput): Promise<number> {
  const { unit, registry } = input;
  const reactions = reactionsInModuleOrder(registry, 'async');
  if (reactions.length === 0) return 0;
  let count = 0;
  for (const event of input.events) {
    if (event.transient || isProcessStream(registry, event.stream.type)) continue;
    const seen = new Map<
      string,
      AsyncReactionEvent<string, unknown, Readonly<Record<string, unknown>>>
    >();
    for (const reaction of reactions) {
      if (!reactionMatches(reaction, event.type)) continue;
      let declaredKey: string | undefined;
      let keyError: string | undefined;
      if (usesKey(reaction)) {
        let shown = seen.get(reaction.module);
        if (shown === undefined) {
          shown = await asyncReactionEventOf(unit, registry, reaction.module, event);
          seen.set(reaction.module, shown);
        }
        let declared: unknown;
        try {
          declared = reaction.key?.(
            reaction.process === true ? { ...shown, current: undefined } : shown,
          );
        } catch {
          declared = undefined;
        }
        keyError = reactionKeyError(reaction, declared);
        if (keyError === undefined) declaredKey = declared as string;
        else
          input.log.warn('the key of a reaction failed for an event', {
            reaction: reaction.id,
            code: keyError,
          });
      }
      let instance: Awaited<ReturnType<typeof processJobInstance>> = {};
      if (reaction.process === true && declaredKey !== undefined) {
        instance = await processJobInstance(unit, reaction, event, declaredKey);
      }
      await input.queue.enqueue(
        reactionJob({
          reaction,
          event,
          declaredKey,
          ...instance,
          ...(keyError === undefined ? {} : { keyError }),
          build: input.build,
          now: input.now,
        }),
        unit,
      );
      count += 1;
    }
  }
  return count;
}
