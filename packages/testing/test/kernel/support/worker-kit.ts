import type {
  AdapterCapabilities,
  Clock,
  JobSpec,
  KernelQueue,
  Logger,
  Scope,
  StoredJobSpec,
  WorkClassStats,
} from '@keelwerk/core';
import { createKernelQueue, hybridClock } from '@keelwerk/core';
import { conformanceApp } from '../../../src/fixtures/index.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import type { TestPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import type { JobSpy } from './job-spy.ts';
import { jobSpy } from './job-spy.ts';

type Conformance = typeof conformanceApp;
type Watched = TestRuntime<Conformance, 'acme'>;

export const workerStart = Temporal.Instant.from('2026-03-01T08:00:00Z');

/** A logger that keeps what was logged, by level. */
export interface Lines {
  readonly warnings: string[];
  readonly errors: string[];
  readonly logger: Logger;
}

export function lines(): Lines {
  const warnings: string[] = [];
  const errors: string[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message) => {
      warnings.push(message);
    },
    error: (message) => {
      errors.push(message);
    },
    child: () => logger,
  };
  return { warnings, errors, logger };
}

/** The conformance app on the in-memory adapter whose job and receipt stores a test watches. */
export async function startWatched(
  options: TestRuntimeOptions<'acme'> & {
    readonly at?: Temporal.Instant;
    readonly app?: Conformance;
    /** Sets up the spy before the runtime connects. */
    readonly configure?: (spy: JobSpy) => void;
  } = {},
) {
  const descriptors = new Map(
    [...conformanceApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const watched = jobSpy((ref) => descriptors.get(ref));
  options.configure?.(watched.spy);
  const clock: Clock = { now: () => options.at ?? workerStart };
  const { app, at: _at, configure, ...rest } = options;
  const runtime: TestRuntime<Conformance, 'acme'> = await startTestRuntime(app ?? conformanceApp, {
    tenants: ['acme'],
    operators: true,
    clock,
    external: { factory: watched.factory, url: 'memory://watched' },
    ...rest,
  });
  return { runtime, ...watched };
}

export function acmeScope(runtime: TestRuntime<Conformance, 'acme'>): Scope {
  return { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants.acme.id };
}

/** Asks `loans.closeAll` to run asynchronously as `as`: the answer is the accepted receipt. */
export function askCloseAll(
  runtime: TestRuntime<Conformance, 'acme'>,
  commandId: string,
  as: TestPrincipal = testOperator('olive'),
) {
  return runtime.invoker.invoke({
    action: 'loans.closeAll',
    input: { borrower: 'bea' },
    carrier: testCarrier(runtime.tenants.acme, as),
    requestId: crypto.randomUUID(),
    commandId,
    prefer: 'async',
    signal: new AbortController().signal,
  });
}

/** Lends a book to `bea` so `askCloseAll` has something to close. */
export async function lendBook(runtime: TestRuntime<Conformance, 'acme'>, title: string) {
  const outcome = await runtime.invoker.invoke({
    action: 'loans.lend',
    input: { bookTitle: title, dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z') },
    carrier: testCarrier(runtime.tenants.acme, { subject: 'bea', roles: [], claims: {} }),
    requestId: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
  if (!outcome.ok) throw outcome.error;
}

/** The queue statistics of a namespace, read in a namespace-scope unit. */
export async function statsOf(
  runtime: TestRuntime<Conformance, 'acme'>,
  queue: string,
): Promise<WorkClassStats | undefined> {
  const all = await runtime.adapter.unit(
    runtime.namespace,
    { level: 'namespace', reason: 'test' },
    (unit) => unit.jobs.stats(queue),
  );
  return all[0];
}

/** What is stored of a job a test enqueues by hand. */
export function jobOf(
  runtime: TestRuntime<Conformance, 'acme'>,
  over: Partial<StoredJobSpec> & { readonly queue: string },
): StoredJobSpec {
  return {
    kind: 'action',
    run: { action: 'loans.closeAll', input: {} },
    scope: acmeScope(runtime) as StoredJobSpec['scope'],
    principal: { resolver: 'core.runtime', principalId: 'core.runtime' },
    causation: {},
    build: { id: 'test-build', revision: 1 },
    laneCap: 4,
    createdAt: workerStart,
    ...over,
  };
}

/** A kernel queue of the test's own over the runtime's namespace, on the runtime's clock. */
export function ownQueue(
  runtime: Watched,
  over: { readonly worker?: string; readonly random?: () => number } = {},
) {
  return createKernelQueue({
    sources: [
      {
        namespace: runtime.namespace,
        // The in-memory adapter keeps no framework track, which its SQL capability says (D8).
        handle: { adapter: runtime.adapter, capabilities: { sql: false } as AdapterCapabilities },
        registry: runtime.app.registry,
      },
    ],
    worker: over.worker ?? 'w-test',
    clock: runtime.clock,
    log: runtime.log,
    writer: { hybridClock: hybridClock('test-node'), build: { id: 'test-build', revision: 1 } },
    random: over.random ?? (() => 0.999),
  });
}

/** What `queue.enqueue` takes, for a job of `queue` that runs `loans.closeAll` (the handler of the test never invokes it). */
export function jobSpecOf(
  runtime: Watched,
  over: Partial<JobSpec> & { readonly queue: string },
): JobSpec {
  return {
    run: { action: 'loans.closeAll', input: {} },
    scope: acmeScope(runtime) as JobSpec['scope'],
    principal: { resolver: 'core.runtime', principalId: 'core.runtime' },
    causation: {},
    build: { id: 'test-build', revision: 1 },
    ...over,
  };
}

/** Enqueues the jobs through the kernel queue in one unit of the tenant scope. */
export async function enqueueAll(runtime: Watched, queue: KernelQueue, specs: readonly JobSpec[]) {
  await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), async (unit) => {
    for (const spec of specs) await queue.enqueue(spec, unit);
  });
}

/** Wakes the queue and settles when it is idle. */
export async function settleQueue(queue: KernelQueue): Promise<void> {
  queue.probe.wake();
  await queue.probe.idle();
}
