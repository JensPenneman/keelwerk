import type { ConsumerSpec, Registry, RuntimeServiceContext } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { dispatcherMark } from './dispatcher-mark.ts';
import { dispatcherSelector } from './dispatcher-selector.ts';
import { enqueueReactionJobs } from './enqueue-reaction-jobs.ts';
import { pauseScopeAtCap } from './pause-scope-at-cap.ts';
import type { ReactionDispatcherOptions } from './reaction-dispatcher-options.ts';

const defaultQueued = 10_000;
const defaultHoldMs = 1000;

function integerOf(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw errors.validation(`${name} is a whole number of at least 1`);
  }
  return value;
}

/**
 * The kernel's reaction dispatcher (7.7, 15.2.3): the consumer `core.reactions`, built when the
 * event worker starts so it can read the registries of the served apps. The consumer starts at the
 * heads: the first time it runs in a scope it begins at that scope's head (`start: 'now'`, the
 * consumer store's `startAtHeads`), so no history is replayed into side effects.
 *
 * Its one checkpoint is shared by every reaction. A reaction added in a later deploy therefore gets
 * jobs for the events after the dispatcher's checkpoint, which includes any backlog written while
 * the dispatcher was down, and for no event before it.
 *
 * For each batch, in the unit of the batch's scope, it first holds the scope when its `reactions`
 * lane holds more than 90 percent of `queued` jobs (only that scope waits; one batch may overshoot
 * the cap by its own jobs, which are not weighed). It then enqueues the jobs of every matching async
 * reaction, skipping the events of process streams; the runner advances the checkpoint in the same unit. Use it as
 * `consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] })`. `validation` for an
 * option that is not a whole number of at least 1.
 */
export function reactionDispatcher(
  options: ReactionDispatcherOptions = {},
): ((context: RuntimeServiceContext) => ConsumerSpec) & { readonly id: 'core.reactions' } {
  const queued = integerOf('queued', options.queued ?? defaultQueued);
  const holdMs = integerOf('holdMs', options.holdMs ?? defaultHoldMs);
  const build = (context: RuntimeServiceContext): ConsumerSpec => {
    const registries = new Map<string, Registry>(
      context.namespaces.map((source) => [source.namespace.id, source.registry] as const),
    );
    const spec: ConsumerSpec = {
      id: 'core.reactions',
      selector: dispatcherSelector(registries.values()),
      start: 'now',
      consume: async (events, unit) => {
        const registry = registries.get(unit.namespace.id);
        if (registry === undefined) {
          throw errors.internal(
            `the dispatcher has no registry for the namespace ${unit.namespace.id}`,
          );
        }
        await pauseScopeAtCap(unit, queued, holdMs);
        await enqueueReactionJobs({
          unit,
          registry,
          events,
          queue: context.queue,
          log: context.log,
          build: context.build,
          now: context.clock.now(),
        });
      },
    };
    return Object.defineProperty(spec, dispatcherMark, { value: true, enumerable: true });
  };
  return Object.defineProperty(
    Object.assign(build, { id: 'core.reactions' } as const),
    dispatcherMark,
    {
      value: true,
      enumerable: true,
    },
  );
}
