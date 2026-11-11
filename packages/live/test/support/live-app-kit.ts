import type {
  AnyModule,
  Carrier,
  InvocationSession,
  KeelwerkError,
  LiveFrame,
  Scope,
  StorageRow,
} from '@keelwerk/core';
import { defineApp } from '@keelwerk/core';
import type { TestPrincipal, TestRuntime, TestTenant } from '@keelwerk/testing';
import { startTestRuntime, testCarrier, testPrincipal } from '@keelwerk/testing';
import { passes } from '@keelwerk/testing/fixtures';
import type { Live } from '../../src/live-module.ts';
import { live } from '../../src/live-module.ts';
import { board } from '../hub/support/board-module.ts';

/** The app of the ticket and revalidation tests: live, the board and the passes fixture. */
function liveApp(module: Live = live, extra: readonly AnyModule[] = []) {
  return defineApp({ id: 'liveapp', modules: [module, board, passes, ...extra] as never });
}

type LiveApp = ReturnType<typeof liveApp>;

export const adaPrincipal = testPrincipal('ada');

/** A started runtime of the live app and the calls the tests make. */
export interface LiveAppKit {
  readonly runtime: TestRuntime<LiveApp>;
  readonly acme: TestTenant;
  readonly globex: TestTenant;
  call<T = unknown>(
    tenant: TestTenant,
    who: TestPrincipal,
    action: string,
    input: unknown,
  ): Promise<T>;
  /** Runs an action and answers its outcome, success or not. */
  attempt(
    carrier: Carrier,
    action: string,
    input: unknown,
  ): Promise<{ ok: boolean; value?: unknown; error?: KeelwerkError }>;
  /** A carrier that presents a pass as its bearer token. */
  bearer(tenant: TestTenant, token: string): Carrier;
  /** A carrier at the backend level (no tenant) for a principal. */
  backendCarrier(who: TestPrincipal): Carrier;
  /** A carrier at the backend level that presents a ticket. */
  backendTicket(value: string, over?: { endpoint?: 'subscribe'; action?: string | null }): Carrier;
  /** The ticket rows as stored at the backend level. */
  backendTickets(): Promise<readonly StorageRow[]>;
  /** A carrier that presents a ticket. */
  ticket(
    tenant: TestTenant,
    value: string,
    over?: { endpoint?: 'subscribe'; action?: string | null },
  ): Carrier;
  /** Opens a session through the runtime's invoker. */
  open(carrier: Carrier): Promise<InvocationSession>;
  /** Opens the `board.cards` subscription and keeps what it yields. */
  follow(
    carrier: Carrier,
    over?: { readonly session?: InvocationSession; readonly action?: string },
  ): Followed;
  /** The ticket rows as stored, for the tenant. */
  tickets(tenant: TestTenant): Promise<readonly StorageRow[]>;
  stop(): Promise<void>;
}

/** What a followed subscription was given. */
export interface Followed {
  readonly frames: LiveFrame<unknown>[];
  readonly failure: () => KeelwerkError | undefined;
  readonly ended: () => boolean;
  until(test: (frames: readonly LiveFrame<unknown>[]) => boolean, ms?: number): Promise<void>;
  stop(): Promise<void>;
}

export async function startLiveApp(
  adapter: 'memory' | 'pglite',
  module: Live = live,
  options: {
    readonly clock?: { now(): Temporal.Instant };
    /** Modules added to the app. */
    readonly extra?: readonly AnyModule[];
  } = {},
): Promise<LiveAppKit> {
  const runtime = await startTestRuntime(liveApp(module, options.extra), {
    adapter,
    tenants: ['acme', 'globex'],
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const { invoker } = runtime;
  const { acme, globex } = runtime.tenants;
  const attempt: LiveAppKit['attempt'] = async (carrier, action, input) => {
    const outcome = await invoker.invoke<unknown, unknown>({
      action,
      input,
      carrier,
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: crypto.randomUUID(),
    });
    return outcome.ok ? { ok: true, value: outcome.value } : { ok: false, error: outcome.error };
  };
  const ticketRows = (scope: Scope): Promise<readonly StorageRow[]> => {
    const descriptor = runtime.app.registry.entities.get('live.streamTicket')?.descriptor;
    if (descriptor === undefined) throw new Error('no live.streamTicket');
    return runtime.adapter.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.rows.find(descriptor, { includeArchived: true })).rows,
    );
  };
  const follow: LiveAppKit['follow'] = (carrier, over = {}) => {
    const frames: LiveFrame<unknown>[] = [];
    const abort = new AbortController();
    let failure: KeelwerkError | undefined;
    let done = false;
    let wake: (() => void) | undefined;
    const iterator = invoker
      .subscribe<unknown, unknown>({
        action: over.action ?? 'board.cards',
        input: over.action === undefined ? { from: 'now' } : {},
        carrier,
        ...(over.session === undefined ? {} : { session: over.session }),
        requestId: crypto.randomUUID(),
        signal: abort.signal,
      })
      [Symbol.asyncIterator]();
    void (async () => {
      try {
        for (;;) {
          const step = await iterator.next();
          if (step.done === true) break;
          frames.push(step.value);
          wake?.();
        }
      } catch (error) {
        failure = error as KeelwerkError;
      } finally {
        done = true;
        wake?.();
      }
    })();
    return {
      frames,
      failure: () => failure,
      ended: () => done,
      until: async (test, ms = 15_000) => {
        const deadline = Date.now() + ms;
        while (!test(frames)) {
          if (done && test(frames)) return;
          if (done) throw new Error(`the stream ended: ${failure?.code ?? 'no error'}`);
          if (Date.now() >= deadline) throw new Error('timed out waiting for the frames');
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 50);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
      },
      stop: async () => {
        abort.abort();
        await iterator.return?.();
      },
    };
  };
  return {
    runtime,
    acme,
    globex,
    attempt,
    call: async (tenant, who, action, input) => {
      const outcome = await attempt(testCarrier(tenant, who), action, input);
      if (!outcome.ok) throw outcome.error;
      return outcome.value as never;
    },
    bearer: (tenant, token) => ({ transport: 'test', headers: { 'x-tenant': tenant.id }, token }),
    ticket: (tenant, value, over = {}) => ({
      transport: 'test',
      headers: { 'x-tenant': tenant.id },
      ticket: { value, endpoint: over.endpoint ?? 'subscribe', action: over.action ?? null },
    }),
    open: async (carrier) => {
      const outcome = await invoker.open(carrier);
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    },
    follow,
    backendCarrier: (who) => ({
      transport: 'test',
      headers: { 'x-backend': runtime.backendId, 'x-test-principal': JSON.stringify(who) },
    }),
    backendTicket: (value, over = {}) => ({
      transport: 'test',
      headers: { 'x-backend': runtime.backendId },
      ticket: { value, endpoint: over.endpoint ?? 'subscribe', action: over.action ?? null },
    }),
    backendTickets: () => ticketRows({ level: 'backend', backendId: runtime.backendId }),
    tickets: (tenant) =>
      ticketRows({ level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id }),
    stop: () => runtime.stop(),
  };
}
