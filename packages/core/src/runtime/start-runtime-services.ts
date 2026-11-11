import type { JobQueue } from '../jobs/job-queue.ts';
import { createKernelQueue } from '../worker/create-kernel-queue.ts';
import { queueSources } from '../worker/queue-sources.ts';
import { kernelServices } from './kernel-services.ts';
import type { RuntimeService } from './runtime-service.ts';
import type { RuntimeServiceContext } from './runtime-service-context.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

/** Seconds a draining process may take when `RuntimeOptions.work` says nothing (21.6). */
const defaultDrainSeconds = 60;

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
 * (`all` runs every service). A start that rejects is logged and the others
 * continue. It never throws synchronously: the start runs in the background, and the function it
 * returns stops every started service at once against one wall-clock deadline (now plus
 * `drainSeconds`), after waiting for the start chain, both within the phase's own deadline signal.
 * A deadline signal that aborts (or is aborted already) before the chain ends makes the chain start
 * nothing more and stop what it started at once, so a start that is given up on leaves no worker.
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
    const queue = createKernelQueue({
      sources,
      worker: connected.processId,
      clock: input.clock,
      log: connected.log,
      writer: connected.control.writer,
    });
    const context: RuntimeServiceContext = {
      build: connected.build,
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
      ledgers: input.composed.infrastructure.ledgers,
      clock: input.clock,
    };
    const started: RuntimeService[] = [];
    const services = [
      ...kernelServices.map((build) => build(input)),
      ...input.composed.infrastructure.eventWorkers,
    ].filter((service) => options.role === 'all' || service.roles.includes(options.role));
    for (const service of services) {
      if (stopping) break;
      try {
        await service.start(context);
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
    if (ready === undefined) return;
    stopped ??= stopAll(
      ready,
      Temporal.Now.instant().add({ seconds: options.work?.drainSeconds ?? defaultDrainSeconds }),
    );
    await Promise.race([stopped, aborted(deadline)]);
  };
}
