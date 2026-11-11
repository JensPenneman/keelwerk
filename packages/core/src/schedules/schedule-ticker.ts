import { errors } from '../errors/errors.ts';
import type { Logger } from '../observability/logger.ts';
import type { RuntimeService } from '../runtime/runtime-service.ts';
import { isKernelQueue } from '../worker/is-kernel-queue.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import { sourceReadiness } from '../worker/source-readiness.ts';
import { defaultScheduleLimits } from './default-schedule-limits.ts';
import type { SchedulePassState } from './run-schedule-pass.ts';
import { runSchedulePass } from './run-schedule-pass.ts';
import type { ScheduleLimits } from './schedule-limits.ts';

/** The most rounds one trigger runs while rows stay due beyond a pass's bounds. */
const maxRounds = 1000;

/** One app namespace the ticker serves. */
interface Namespace {
  readonly source: QueueSource;
  readonly state: SchedulePassState;
  readonly trigger: () => Promise<void>;
  /** The pass in flight. */
  running(): Promise<void> | undefined;
}

function newState(): SchedulePassState {
  return {
    seeded: new Set(),
    held: new Map(),
    busy: new Set(),
    running: new Set(),
    fanOut: undefined,
    reseedAt: undefined,
    cursor: undefined,
    offset: 0,
    remaining: false,
    stopping: false,
    abandon: new AbortController(),
  };
}

/**
 * The schedule ticker `core.schedules` (9.5.6, S-118, S-165), roles ['work']. `start` keeps one
 * `SchedulePassState` per app namespace of `context.namespaces` (the control namespace and the
 * registries without schedules left out), gated by `sourceReadiness` (framework step 0002), starts one
 * pass per namespace at once without waiting for it, then every `passEveryMs` on an unref'd wall timer, never two passes of
 * one namespace at a time (a trigger while one runs reruns it once after). On a kernel queue it
 * calls `queue.attend(...)` with a run that triggers every namespace's pass, repeats while rows stay
 * due beyond the bounds, and settles when those passes and every backend task settled. `stop` clears
 * the timer, starts nothing more, waits for the running tasks until the deadline and leaves the
 * rest: their late rejection is caught and logged once ('a schedule tick was abandoned at the stop
 * deadline'); a unit still open then is aborted through its signal and commits nothing.
 */
export function createScheduleTicker(limits?: Partial<ScheduleLimits>): RuntimeService {
  const bounds: ScheduleLimits = { ...defaultScheduleLimits, ...limits };
  const served: Namespace[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopping = false;
  let log: Logger | undefined;

  return {
    id: 'core.schedules',
    roles: ['work'],
    start: async (context) => {
      log = context.log;
      const readiness = sourceReadiness(context.clock, context.log, 'its schedules');
      for (const source of context.namespaces) {
        if (source.namespace.id === context.control.namespace.id) continue;
        const app = context.apps.get(source.namespace.appId);
        if (app === undefined || source.registry.schedules.size === 0) continue;
        const state = newState();
        let running: Promise<void> | undefined;
        let again = false;
        const pass = async (): Promise<void> => {
          if (!(await readiness.ready(source))) return;
          await runSchedulePass({ context, source, served: app, limits: bounds, state });
        };
        const trigger = (): Promise<void> => {
          if (running !== undefined) {
            again = true;
            return running;
          }
          const run = (async () => {
            do {
              again = false;
              try {
                await pass();
              } catch (error) {
                // A pass cut short by the stop is reported once by `stop`, not as a failure.
                if (!stopping) context.log.error('a schedule pass failed', { cause: error });
              }
            } while (again && !stopping);
          })().finally(() => {
            running = undefined;
          });
          running = run;
          return run;
        };
        served.push({ source, state, trigger, running: () => running });
      }
      const triggerAll = async (): Promise<void> => {
        await Promise.all(served.map(({ trigger }) => trigger()));
      };
      const attended = async (): Promise<void> => {
        for (let round = 0; round < maxRounds && !stopping; round += 1) {
          readiness.recheck();
          await triggerAll();
          await Promise.allSettled(served.flatMap(({ state }) => [...state.running]));
          if (!served.some(({ state }) => state.remaining)) return;
        }
      };
      if (isKernelQueue(context.queue)) context.queue.attend(attended);
      // The first pass does not hold the start: a namespace that is not ready, or slow, must not delay
      // the runtime. It has its own catch (a pass already logs its failure; this is the last net).
      void triggerAll().catch((error: unknown) => {
        context.log.error('the first schedule pass failed', { cause: error });
      });
      if (!stopping && served.length > 0) {
        timer = setInterval(() => {
          void triggerAll();
        }, bounds.passEveryMs);
        timer.unref();
      }
    },
    stop: async (deadline) => {
      stopping = true;
      clearInterval(timer);
      for (const { state } of served) state.stopping = true;
      const pending = served.flatMap(({ state, running }) => {
        const pass = running();
        return [...(pass === undefined ? [] : [pass]), ...state.running];
      });
      if (pending.length === 0) return;
      // The deadline is wall-clock time (the runtime's stop adds its drain seconds to the real now).
      const waitMs = Math.max(
        0,
        deadline.epochMilliseconds - Temporal.Now.instant().epochMilliseconds,
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<'late'>((resolve) => {
        timeout = setTimeout(() => resolve('late'), waitMs);
        timeout.unref();
      });
      const outcome = await Promise.race([
        Promise.allSettled(pending).then(() => 'done' as const),
        expired,
      ]);
      clearTimeout(timeout);
      if (outcome === 'late') {
        for (const { state } of served) {
          state.abandon.abort(errors.unavailable('The schedule ticker stopped at its deadline.'));
        }
        log?.warn('a schedule tick was abandoned at the stop deadline', { tasks: pending.length });
      }
    },
  };
}
