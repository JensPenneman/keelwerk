import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import { frameworkReady } from './framework-ready.ts';
import type { QueueSource } from './queue-source.ts';

const recheckMs = 60_000;

interface State {
  ready: boolean;
  checkedAt: Temporal.Instant | undefined;
  warned: boolean;
  again: boolean;
  /** The check that is under way: a sweep that asks meanwhile waits for it. */
  checking: Promise<boolean> | undefined;
}

/** Which sources have the framework tables (D8); a source that is ready stays ready. */
export interface SourceReadiness {
  /** True when the worker may take jobs from the source. */
  ready(source: QueueSource): Promise<boolean>;
  /** An explicit wake: every source that is behind is checked again at its next sweep. */
  recheck(): void;
}

/**
 * The framework check of the fetchers (D8): a source that is behind takes no jobs, is logged once as
 * a warning, and is checked again at every explicit wake and otherwise at most once per minute of
 * clock time. A sweep that asks while a check is under way waits for its answer (unless an explicit
 * wake came after the check began: that sweep checks afresh), so no fetcher skips its first sweep on
 * a source that is about to turn out ready. An adapter without SQL tables is always ready. `waiting`
 * names what waits (the warning reads "<waiting> wait for keelwerk db apply").
 */
export function sourceReadiness(
  clock: Clock,
  log: Logger,
  /** What waits on a source that is behind, as the warning names it. */
  waiting = 'its jobs',
): SourceReadiness {
  const states = new Map<QueueSource, State>();
  return {
    recheck: () => {
      for (const state of states.values()) state.again = true;
    },
    ready: async (source) => {
      const state: State = states.get(source) ?? {
        ready: false,
        checkedAt: undefined,
        warned: false,
        again: false,
        checking: undefined,
      };
      states.set(source, state);
      if (state.ready) return true;
      if (state.checking !== undefined && !state.again) return state.checking;
      const now = clock.now();
      if (
        state.checkedAt !== undefined &&
        !state.again &&
        Temporal.Instant.compare(now, state.checkedAt.add({ milliseconds: recheckMs })) < 0
      ) {
        return false;
      }
      state.checkedAt = now;
      state.again = false;
      const checking = (async (): Promise<boolean> => {
        try {
          // A check that began before an explicit wake can answer after a fresher one: it never turns a ready source back.
          if (await frameworkReady(source)) state.ready = true;
        } catch (error) {
          log.warn('the framework track of a namespace could not be read', {
            namespace: source.namespace.id,
            cause: error,
          });
          return false;
        }
        if (!state.ready && !state.warned) {
          state.warned = true;
          log.warn(
            `namespace ${source.namespace.id} misses framework step 0002; ${waiting} wait for \`keelwerk db apply\``,
            { namespace: source.namespace.id },
          );
        }
        return state.ready;
      })().finally(() => {
        if (state.checking === checking) state.checking = undefined;
      });
      state.checking = checking;
      return checking;
    },
  };
}
