import type { ConsumerSpec, Position, RuntimeServiceContext, StreamRef } from '@keelwerk/core';
import { errors, sourceReadiness } from '@keelwerk/core';
import { isReactionDispatcher } from '../dispatcher/is-reaction-dispatcher.ts';
import type { ConsumerRunner } from './consumer-runner.ts';
import type { ConsumersOptions } from './consumers-options.ts';
import type { ConsumersWorker } from './consumers-worker.ts';
import { createConsumerRunner } from './create-consumer-runner.ts';

const defaultLeaseMs = 30_000;
const defaultBatchSize = 100;
const maxBatchSize = 1000;
/** The wall timer never sleeps longer than this, and not shorter than the floor. */
const maxTimerMs = 1000;
const minTimerMs = 100;

const noDispatcher =
  "runs lists 'asyncReactions' and no consumer is the reaction dispatcher (core.reactions)";

function integerIn(name: string, value: number, least: number, most?: number): void {
  if (!Number.isInteger(value) || value < least || (most !== undefined && value > most)) {
    throw errors.validation(
      most === undefined
        ? `${name} is a whole number of at least ${least}`
        : `${name} is a whole number from ${least} to ${most}`,
    );
  }
}

/** The `core.` ids are the kernel's: only the reaction dispatcher, recognised by its mark and not by its id, may use one. */
function checkKernelId(entry: { readonly id?: string }): void {
  if (entry.id?.startsWith('core.') === true && !isReactionDispatcher(entry)) {
    throw errors.validation(
      `the consumer id ${entry.id} starts with "core.", which is reserved for the kernel's consumers`,
    );
  }
}

function checkSpec(spec: ConsumerSpec, seen: Set<string>): void {
  if (spec.id.length === 0) throw errors.validation('a consumer needs an id');
  checkKernelId(spec);
  if (seen.has(spec.id)) throw errors.validation(`the consumer id ${spec.id} is used twice`);
  seen.add(spec.id);
  if (spec.maxAttempts !== undefined) integerIn('maxAttempts', spec.maxAttempts, 1);
}

/**
 * The event worker that runs consumers (15.2.3, S-154): one runner per consumer and namespace of
 * the process, in processes with the `work` role. It follows the change feeds of the namespaces,
 * wakes the runner of every scope that committed, and a wall timer of at most one second runs each
 * runner whose renewal, acquisition or held scope is due on the runtime clock. Stopping halts every
 * runner at once, waits for the passes in flight until the deadline and hands the lease over of each
 * runner that has ended its work; a runner still in `consume` keeps its lease until it expires.
 */
export function consumers(options: ConsumersOptions): ConsumersWorker {
  const leaseMs = options.leaseMs ?? defaultLeaseMs;
  const batchSize = options.batchSize ?? defaultBatchSize;
  integerIn('leaseMs', leaseMs, 3);
  integerIn('batchSize', batchSize, 1, maxBatchSize);
  const plain = new Set<string>();
  for (const entry of options.consumers) {
    if (typeof entry === 'function') checkKernelId(entry);
    else checkSpec(entry, plain);
  }
  // The reaction dispatcher is what makes `asyncReactions` true. Claiming it without the dispatcher
  // would lift the boot check and leave every async reaction without a worker, and a failure inside
  // the asynchronous start does not stop a runtime, so the claim is checked here, before any boot.
  if (options.runs?.includes('asyncReactions') === true) {
    if (!options.consumers.some((entry) => isReactionDispatcher(entry))) {
      throw errors.validation(noDispatcher);
    }
  }

  const runners: ConsumerRunner[] = [];
  const running = new Map<ConsumerRunner, { again: boolean; promise: Promise<void> | undefined }>();
  const started = Promise.withResolvers<void>();
  // A start that fails rejects `settled`; nobody else needs to see that rejection.
  started.promise.catch(() => undefined);
  const stopping = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let context: RuntimeServiceContext | undefined;

  const trigger = (runner: ConsumerRunner): void => {
    const state = running.get(runner);
    if (state === undefined || stopping.signal.aborted) return;
    state.again = true;
    if (state.promise !== undefined) return;
    state.promise = (async () => {
      try {
        while (state.again && !stopping.signal.aborted) {
          state.again = false;
          try {
            await runner.pass();
          } catch (error) {
            context?.log.error('a consumer pass failed', {
              consumer: runner.consumer,
              cause: error,
            });
          }
        }
      } finally {
        state.promise = undefined;
      }
    })();
  };

  const schedule = (): void => {
    if (stopping.signal.aborted || context === undefined) return;
    const now = context.clock.now();
    let wait = maxTimerMs;
    for (const runner of runners) {
      wait = Math.min(wait, runner.dueAt().epochMilliseconds - now.epochMilliseconds);
    }
    timer = setTimeout(
      () => {
        const at = context?.clock.now();
        if (at !== undefined) {
          for (const runner of runners) {
            if (Temporal.Instant.compare(runner.dueAt(), at) <= 0) trigger(runner);
          }
        }
        schedule();
      },
      Math.max(minTimerMs, wait),
    );
    timer.unref();
  };

  const follow = (start: RuntimeServiceContext): void => {
    const adapters = new Map<
      (typeof start.namespaces)[number]['handle']['adapter'],
      (typeof start.namespaces)[number][]
    >();
    for (const source of start.namespaces) {
      const own = adapters.get(source.handle.adapter) ?? [];
      own.push(source);
      adapters.set(source.handle.adapter, own);
    }
    for (const [adapter, own] of adapters) {
      void (async () => {
        try {
          for await (const wake of adapter.feed.wake(
            own.map((source) => source.namespace),
            stopping.signal,
          )) {
            for (const runner of runners) {
              if (runner.namespace.id !== wake.namespace) continue;
              runner.wake(wake.scopeIds);
              trigger(runner);
            }
          }
        } catch (error) {
          if (!stopping.signal.aborted) {
            start.log.error('the change feed of the consumers failed', { cause: error });
          }
        }
      })();
    }
  };

  const runnerOf = (consumer: string, namespaceId: string): ConsumerRunner | undefined =>
    runners.find((runner) => runner.consumer === consumer && runner.namespace.id === namespaceId);

  return {
    id: 'events.consumers',
    roles: ['work'],
    kind: 'eventWorker',
    provides: [],
    runs: options.runs ?? [],
    start: async (start) => {
      try {
        context = start;
        const seen = new Set<string>();
        const specs = options.consumers.map((entry) =>
          typeof entry === 'function' ? entry(start) : entry,
        );
        for (const spec of specs) checkSpec(spec, seen);
        // The reaction dispatcher is what makes `asyncReactions` true: claiming it without the
        // dispatcher would lift the boot check and leave every async reaction without a worker.
        if (
          options.runs?.includes('asyncReactions') === true &&
          !specs.some(isReactionDispatcher)
        ) {
          throw errors.validation(noDispatcher);
        }
        const owner = crypto.randomUUID();
        const readiness = sourceReadiness(start.clock, start.log, 'its consumers');
        for (const spec of specs) {
          for (const source of start.namespaces) {
            const runner = createConsumerRunner({
              spec,
              source,
              directory: start.directory,
              deploymentId: start.control.deploymentId,
              owner,
              leaseMs,
              batchSize,
              clock: start.clock,
              log: start.log,
              ready: () => readiness.ready(source),
            });
            runners.push(runner);
            running.set(runner, { again: false, promise: undefined });
          }
        }
        follow(start);
        for (const runner of runners) trigger(runner);
        schedule();
        started.resolve();
      } catch (error) {
        started.reject(error);
        throw error;
      }
    },
    stop: async (deadline) => {
      stopping.abort();
      if (timer !== undefined) clearTimeout(timer);
      // Before any waiting: no runner begins another scope, replay or turn during the stop window.
      for (const runner of runners) runner.halt();
      const inFlight = [...running.values()].flatMap((state) =>
        state.promise === undefined ? [] : [state.promise],
      );
      if (inFlight.length > 0) {
        const left = Math.max(0, deadline.epochMilliseconds - Date.now());
        let giveUp: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.allSettled(inFlight),
          new Promise<void>((resolve) => {
            giveUp = setTimeout(resolve, left);
          }),
        ]);
        clearTimeout(giveUp);
      }
      await Promise.all(
        runners.map((runner) =>
          runner.stop(deadline).catch((error: unknown) => {
            context?.log.warn('a consumer lease could not be handed over', {
              consumer: runner.consumer,
              cause: error,
            });
          }),
        ),
      );
    },
    settled: async () => {
      await started.promise;
      let total = 0;
      for (;;) {
        let round = 0;
        for (const runner of runners) round += (await runner.pass({ sweep: true })).batches;
        if (round === 0) return total;
        total += round;
      }
    },
    unpark: async (
      consumer: string,
      namespaceId: string,
      scopeId: string,
      stream: StreamRef,
    ): Promise<Position | null> => {
      const runner = runnerOf(consumer, namespaceId);
      if (runner === undefined) {
        throw errors.not_found(`No runner of the consumer ${consumer} runs in this process.`);
      }
      return runner.unpark(scopeId, stream);
    },
  };
}
