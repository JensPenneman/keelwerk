import type { JobQueue } from '../jobs/job-queue.ts';
import { liveTimersOf } from '../live/live-timers-of.ts';
import { createKernelQueue } from '../worker/create-kernel-queue.ts';
import { queueSources } from '../worker/queue-sources.ts';
import { kernelServices } from './kernel-services.ts';
import type { RuntimeService } from './runtime-service.ts';
import type { RuntimeServiceContext } from './runtime-service-context.ts';
import type { StartPhaseInput } from './start-phase-input.ts';
import { staysInService } from './stays-in-service.ts';

/** Seconds a draining process may take when `RuntimeOptions.work` says nothing (21.6). */
const defaultDrainSeconds = 60;

/**
 * How long the stop waits, after its own deadline, for the services to give back what they hold in
 * the store (`RuntimeService.expire`): the grace of the workers for their handlers (one second) and
 * one unit of the store; and, when the start chain is still running at the deadline, for it to end
 * and stop what it started.
 */
const expireWaitMs = 5000;

/** Settles when `work` does or after `ms`, whichever is first; never rejects. */
async function waitUpTo(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/**
 * The runtime-service seam (F-19, S-154, D7): builds the kernel queue over the namespaces of the
 * process, and starts the kernel services in list order and then the event workers of the
 * deployment, each start awaited before the next and every one whose roles match the process role
 * (`all` runs every service). Every service except those of `staysInService` gets a `signal` that
 * also aborts when the process gate closes, even with its evidence still pending. A start that
 * rejects is logged and the others continue. It never throws synchronously: the start runs in the
 * background, and the function it returns stops every started service at once against one
 * wall-clock deadline (now plus `drainSeconds`), after waiting for the start chain; both waits end
 * when the phase's own deadline signal aborts (the one exception to that deadline is in `stopPhase`).
 * A deadline signal that aborts (or is aborted already) before the chain ends makes the chain start
 * nothing more and stop what it started at once; the returned stop then still waits for that chain
 * and its stop, at most `expireWaitMs`, so a start that is given up on leaves no worker running
 * after the stop returned.
 * The probe goes to `options.work` after the services started, and only in a process that works
 * (a process with the `serve` role has no fetcher to watch).
 */
export function startRuntimeServices(
  input: StartPhaseInput,
): (deadline: AbortSignal) => Promise<void> {
  const { connected, options } = input;
  let ready: readonly RuntimeService[] | undefined;
  let stopping = false;
  let stopped: Promise<void> | undefined;
  const stopAll = (started: readonly RuntimeService[], due: Temporal.Instant): Promise<void> =>
    Promise.all(
      started.map((service) =>
        service.stop(due).catch((error: unknown) => {
          connected.log.warn('a runtime service did not stop cleanly', {
            service: service.id,
            cause: error,
          });
        }),
      ),
    ).then(() => undefined);
  const running = (async (): Promise<readonly RuntimeService[]> => {
    const sources = await queueSources(input);
    // The view is live over the cache's rows: the dispatcher asks the cache before each batch.
    const quotas = await input.quotas?.fresh();
    const queue = createKernelQueue({
      sources,
      worker: connected.processId,
      clock: input.clock,
      log: connected.log,
      writer: connected.control.writer,
      ...(quotas === undefined ? {} : { quotas }),
    });
    const context: RuntimeServiceContext = {
      build: connected.build,
      compute: connected.compute,
      control: connected.control,
      keys: connected.keys,
      log: connected.log,
      placements: connected.placements,
      signal: connected.signal,
      apps: input.apps,
      invoker: input.invoker,
      queue: queue satisfies JobQueue,
      namespaces: sources,
      directory: input.migrated.directory.lookup,
      archivedDirectory: input.migrated.directory.archivedLookup,
      ledgers: input.composed.infrastructure.ledgers,
      clock: input.clock,
      ...(input.quotas === undefined ? {} : { quotas: input.quotas }),
      timers: options.timers ?? liveTimersOf(input.clock),
    };
    // A service stops its work when `signal` aborts: at teardown, or when the process gate closes
    // (a restore was found under it). Only the services of `staysInService` keep the plain one.
    const leaving =
      input.gate === undefined ? undefined : AbortSignal.any([connected.signal, input.gate.signal]);
    const contextOf = (service: RuntimeService): RuntimeServiceContext =>
      leaving === undefined || staysInService.has(service.id)
        ? context
        : { ...context, signal: leaving };
    const started: RuntimeService[] = [];
    const services = [
      ...kernelServices.map((build) => build(input)),
      ...input.composed.infrastructure.eventWorkers,
    ].filter((service) => options.role === 'all' || service.roles.includes(options.role));
    for (const service of services) {
      if (stopping) break;
      try {
        await service.start(contextOf(service));
        started.push(service);
      } catch (error) {
        connected.log.error('a runtime service did not start', {
          service: service.id,
          cause: error,
        });
      }
    }
    // The probe goes out when the workers are running, so a drain never sees the start half done.
    if (options.role !== 'serve') options.work?.probe?.(queue.probe);
    return started;
  })()
    .catch((error: unknown) => {
      connected.log.error('the runtime services did not start', { cause: error });
      return [];
    })
    .then((started) => {
      ready = started;
      // The stop gave up on the start chain: what it started is stopped now, and nothing more starts.
      if (stopping) stopped ??= stopAll(started, Temporal.Now.instant());
    });
  return async (deadline) => {
    if (deadline.aborted) stopping = true;
    else {
      deadline.addEventListener(
        'abort',
        () => {
          stopping = true;
        },
        { once: true },
      );
    }
    await Promise.race([running, aborted(deadline)]);
    if (ready === undefined) {
      // The chain is still starting: it stops what it started when it ends (`stopped` is set before
      // `running` settles), and the adapters must stay open until that is done.
      await waitUpTo(
        running.then(() => stopped),
        expireWaitMs,
      );
      return;
    }
    stopped ??= stopAll(
      ready,
      Temporal.Now.instant().add({ seconds: options.work?.drainSeconds ?? defaultDrainSeconds }),
    );
    const inTime = await Promise.race([
      stopped.then(() => true),
      aborted(deadline).then(() => false),
    ]);
    if (inTime) return;
    // The stop is about to close the adapters: the workers still holding attempts release them now,
    // while the store is open (21.6 step 4), and not at the later abort of the process.
    await waitUpTo(
      Promise.all(
        ready.map((service) =>
          service.expire?.().catch((error: unknown) => {
            connected.log.warn('a runtime service did not give back what it holds', {
              service: service.id,
              cause: error,
            });
          }),
        ),
      ),
      expireWaitMs,
    );
  };
}
