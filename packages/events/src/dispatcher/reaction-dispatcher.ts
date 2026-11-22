import type { ConsumerSpec, Registry, RuntimeServiceContext } from '@keelwerk/core';
import { errors, jobKeyInfo } from '@keelwerk/core';
import { dispatcherMark } from './dispatcher-mark.ts';
import { dispatcherSelector } from './dispatcher-selector.ts';
import { enqueueReactionJobs } from './enqueue-reaction-jobs.ts';
import { pauseScopeAtCap } from './pause-scope-at-cap.ts';
import type { ReactionDispatcherOptions } from './reaction-dispatcher-options.ts';

const defaultQueued = 10_000;
const defaultHoldMs = 1000;
const defaultMaxDepth = 64;
// A lineage depth is stored as a 32-bit integer, and a depth at or above 2^31 reads as malformed (depth 0): a chain would start again.
const greatestMaxDepth = 2_147_483_646;
// `queued` is asked of the job store as floor(9 * queued / 10), a limit the store refuses above 2,147,483,646.
const greatestQueued = 2_386_092_940;

function integerOf(name: string, value: number, greatest = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || value < 1 || value > greatest) {
    throw errors.validation(
      greatest === Number.MAX_SAFE_INTEGER
        ? `${name} is a whole number of at least 1`
        : `${name} is a whole number from 1 to ${greatest.toLocaleString('en-US')}`,
    );
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
 * the cap by its own jobs, which are not weighed). It then enqueues the jobs of every matching
 * async reaction, skipping the events of process streams; the runner advances the checkpoint in the
 * same unit. Use it as
 * `consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] })`. `validation` for an
 * option that is not a whole number of at least 1, for a `queued` above 2,386,092,940 and for a
 * `maxDepth` above 2,147,483,646.
 */
export function reactionDispatcher(
  options: ReactionDispatcherOptions = {},
): ((context: RuntimeServiceContext) => ConsumerSpec) & { readonly id: 'core.reactions' } {
  const queued = integerOf('queued', options.queued ?? defaultQueued, greatestQueued);
  const holdMs = integerOf('holdMs', options.holdMs ?? defaultHoldMs);
  const maxDepth = integerOf('maxDepth', options.maxDepth ?? defaultMaxDepth, greatestMaxDepth);
  const build = (context: RuntimeServiceContext): ConsumerSpec => {
    const registries = new Map<string, Registry>(
      context.namespaces.map((source) => [source.namespace.id, source.registry] as const),
    );
    const spec: ConsumerSpec = {
      id: 'core.reactions',
      selector: dispatcherSelector(registries.values()),
      start: 'now',
      // The job key secret is derived here, before the unit opens, and handed to `consume`: the
      // scope key must exist by then, and a derivation inside the unit would open a second unit
      // once the key service's cache expired.
      beforeBatch: async (scope) => {
        // Asked before the batch's unit, so the lanes of the reaction jobs it enqueues take the
        // limits of the cache as they are now (the kernel queue reads them, `createKernelQueue`).
        await context.quotas?.fresh();
        return context.keys.derive(scope, jobKeyInfo, 32);
      },
      consume: async (events, unit, prepared) => {
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
          // Without `beforeBatch` (a direct call of `consume`) the secret is derived here.
          keySecret:
            prepared instanceof Uint8Array
              ? prepared
              : await context.keys.derive(unit.scope, jobKeyInfo, 32),
          log: context.log,
          maxDepth,
          ...(options.meter === undefined ? {} : { meter: options.meter }),
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
