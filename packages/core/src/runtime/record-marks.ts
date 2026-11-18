import { recordScopeMarks } from '../control/record-scope-marks.ts';
import { errors } from '../errors/errors.ts';
import { liveTimersOf } from '../live/live-timers-of.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import { bumpRewoundScopes, type RewoundScope } from './bump-rewound-scopes.ts';
import type { RuntimeService } from './runtime-service.ts';
import type { RuntimeServiceContext } from './runtime-service-context.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

const everyMs = 60_000;

/**
 * Service `core.marks`, roles `['serve', 'work']` (14.7.6, S-119): every 60 000 ms of the runtime
 * clock records the marks of every namespace of the process (`recordScopeMarks`, one memo per
 * process, so a scope that did not move writes nothing) and then reads the bumped marks, which
 * keeps the epoch cache current with the bumps other processes made. A failure is logged at warn
 * and waits for the next minute; `stop` ends the loop and records once more, raced against the
 * deadline.
 *
 * The same pass watches for a restore under the running process, which the boot check cannot see:
 * the last position of every scope is kept, and a scope whose counters now read below it, or a
 * namespace whose adapter identity (cluster and timeline) is no longer the one the process started
 * with, was rewound. The process logs at error, closes its gate (the invoker refuses with
 * `core.unavailable`, the process row leaves `ready` and `Runtime.outOfService` settles) and records
 * nothing more, so its supervisor restarts it and the boot check bumps the epochs. A rewound scope's
 * mark first moves to a new epoch in the control store (`bumpRewoundScopes`), so the evidence does
 * not live only in the memory of the process that exits: every later boot finds the counters below
 * the mark, and the other processes take the epoch at their next read. A control store that cannot
 * take the bump does not stop the gate from closing, but the process does not leave: the failure
 * is logged at error, the bump is tried again at every pass, and `Runtime.outOfService` settles
 * once it is recorded.
 */
export function recordMarks(input: StartPhaseInput): RuntimeService {
  const timers = input.options.timers ?? liveTimersOf(input.clock);
  const ending = new AbortController();
  const memo = new Map<string, string>();
  // Keyed by namespace and scope together (`recordScopeMarks`).
  const positions = new Map<string, bigint>();
  const identities = new Map<string, string>();
  let loop: Promise<void> | undefined;
  let record: (() => Promise<void>) | undefined;
  const identityOf = async (
    source: RuntimeServiceContext['namespaces'][number],
  ): Promise<string> => {
    const { systemId, timeline } = await source.handle.adapter.identity();
    return `${systemId}\u0000${timeline}`;
  };
  // The rewound scopes whose bump the control store has not taken yet: tried again every pass.
  let unrecorded:
    | { readonly source: QueueSource; readonly rewound: readonly RewoundScope[] }
    | undefined;
  const takeOut = (
    context: RuntimeServiceContext,
    reason: string,
    fields: object,
    evidence?: 'pending',
  ): void => {
    context.log.error(
      'a restore was detected under the running process: it stops serving and exits so that it restarts',
      { reason, ...fields },
    );
    input.gate?.close(reason, evidence === undefined ? undefined : { evidence });
  };
  const bump = async (
    context: RuntimeServiceContext,
    target: NonNullable<typeof unrecorded>,
  ): Promise<boolean> => {
    try {
      await bumpRewoundScopes({
        control: context.control,
        source: target.source,
        rewound: target.rewound,
        now: input.clock.now(),
      });
      return true;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
      context.log.error(
        'the epoch of a rewound scope could not be recorded: the process stays until it is',
        { code },
      );
      return false;
    }
  };
  const recordAll = async (context: RuntimeServiceContext): Promise<void> => {
    if (input.gate?.closed === true) {
      // Out of service: only the evidence of the rewind is still owed.
      if (unrecorded !== undefined && (await bump(context, unrecorded))) {
        unrecorded = undefined;
        input.gate.recorded();
      }
      return;
    }
    try {
      const now = input.clock.now();
      for (const source of context.namespaces) {
        const known = identities.get(source.namespace.id);
        const current = await identityOf(source);
        if (known !== undefined && known !== current) {
          takeOut(context, 'identity', { namespace: source.namespace.id });
          return;
        }
        identities.set(source.namespace.id, current);
        const rewound: RewoundScope[] = [];
        await recordScopeMarks(context.control, source, {
          now,
          memo,
          positions,
          onRewind: (counters, was) => {
            rewound.push({ counters, was });
          },
        });
        const first = rewound[0];
        if (first !== undefined) {
          // The evidence must outlive this process: the marks move to a new epoch before it exits,
          // and a store that cannot take it keeps the process (out of service) until it can. The
          // gate closes first: a store that hangs must not keep the process serving on rewound
          // counters while the bump is in flight.
          const target = { source, rewound };
          takeOut(
            context,
            'position',
            {
              namespace: source.namespace.id,
              scope: first.counters.scopeId,
              was: first.was.toString(),
              now: first.counters.position.toString(),
            },
            'pending',
          );
          if (await bump(context, target)) input.gate?.recorded();
          else unrecorded = target;
          return;
        }
      }
      await context.control.marks.bumped();
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
      context.log.warn('the scope marks could not be recorded', { code });
    }
  };
  return {
    id: 'core.marks',
    roles: ['serve', 'work'],
    start: async (context) => {
      record = () => recordAll(context);
      for (const source of context.namespaces) {
        try {
          identities.set(source.namespace.id, await identityOf(source));
        } catch (error) {
          const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
          context.log.warn('the identity of a namespace could not be read', { code });
        }
      }
      const stopSignal = AbortSignal.any([ending.signal, context.signal]);
      loop = (async () => {
        let next = input.clock.now().add({ milliseconds: everyMs });
        while (await timers.sleepUntil(next, stopSignal)) {
          await record?.();
          next = input.clock.now().add({ milliseconds: everyMs });
        }
      })();
      await Promise.resolve();
    },
    stop: async (deadline) => {
      ending.abort(errors.unavailable('The mark recorder stopped.'));
      const settled = (async () => {
        await loop;
        await record?.();
      })();
      const waitMs = Math.max(
        0,
        deadline.epochMilliseconds - Temporal.Now.instant().epochMilliseconds,
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, waitMs);
        timeout.unref();
      });
      await Promise.race([settled, expired]);
      clearTimeout(timeout);
    },
  };
}
