import type { Invoker } from '@keelwerk/core';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';

/** A barrier: `pass` waits until `open`, `arrived(n)` resolves once `n` callers wait at it. */
export function barrier() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = 0;
  const watchers: { readonly n: number; readonly resolve: () => void }[] = [];
  return {
    pass: async () => {
      waiting += 1;
      for (const watcher of watchers) if (waiting >= watcher.n) watcher.resolve();
      await opened;
    },
    arrived: (n: number) =>
      new Promise<void>((resolve) => {
        if (waiting >= n) resolve();
        else watchers.push({ n, resolve });
      }),
    open: release,
  };
}

/** What the helpers need of a running deployment of the flow app. */
export interface FlowRuntime {
  readonly invoker: Invoker;
  readonly tenants: Readonly<Record<'acme' | 'globex', Parameters<typeof testCarrier>[0]>>;
}

/** One call as the tenant's user. */
export function callFlow(
  runtime: FlowRuntime,
  tenant: 'acme' | 'globex',
  action: string,
  input: unknown = {},
) {
  return runtime.invoker.invoke<unknown, Record<string, unknown>>({
    action,
    input,
    carrier: testCarrier(runtime.tenants[tenant], testPrincipal('ada')),
    requestId: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

/** A subscription that is open: `close` ends it, `next` answers its next change, `undefined` once it has ended. */
export interface OpenNotes {
  readonly close: () => void;
  readonly next: () => Promise<unknown>;
}

/**
 * Opens `flow.notes` as the tenant's user and reads up to its head, which ends the setup: answers
 * the open stream, or `{ error }` for the refusal of the setup.
 */
export async function openNotes(
  runtime: FlowRuntime,
  tenant: 'acme' | 'globex',
  input: unknown = { page: 1 },
): Promise<OpenNotes | { readonly error: unknown }> {
  const abort = new AbortController();
  const iterator = runtime.invoker
    .subscribe<unknown, unknown>({
      action: 'flow.notes',
      input,
      carrier: testCarrier(runtime.tenants[tenant], testPrincipal('ada')),
      requestId: crypto.randomUUID(),
      signal: abort.signal,
    })
    [Symbol.asyncIterator]();
  try {
    for (;;) {
      const step = await iterator.next();
      if (step.done === true) break;
      if ('control' in step.value && step.value.control === 'head') break;
    }
  } catch (error) {
    return { error };
  }
  return {
    close: () => abort.abort(),
    next: async () => {
      for (;;) {
        const step = await iterator.next();
        if (step.done === true) return undefined;
        if (!('control' in step.value)) return step.value;
      }
    },
  };
}
