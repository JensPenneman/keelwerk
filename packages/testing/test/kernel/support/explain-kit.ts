import type { Carrier, Logger } from '@keelwerk/core';
import { dryRun, normalizeRule } from '@keelwerk/core';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { behaviours, bookEntity, loanEntity } from './command-kit.ts';
import { deriveOnlyKeys } from './derive-only-keys.ts';
import { effectEntity, type registryWith } from './effects-kit.ts';
import { clock, namespace, open, silent, tenant, userOf } from './run-read-kit.ts';
import { ada, boot, deploymentOf, type Kind } from './runtime-kit.ts';
import { type Watched, watching } from './watching-factory.ts';

/** What `core.explain` answers, as the tests read it. */
export interface Answer {
  readonly requested: { readonly kind: string; readonly id: string };
  readonly command: {
    readonly commandId: string;
    readonly events: readonly { readonly eventId: string }[];
  };
}

/** A logger that keeps the lines `info` receives. */
export function capturing(lines: string[]): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: (line) => {
      lines.push(line);
    },
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  return logger;
}

export async function setup(
  kind: Kind,
  over: Parameters<typeof boot>[1] = {},
  deployment: Parameters<typeof deploymentOf>[1] = {},
) {
  const watched: Watched = { seen: new Map() };
  const runtime = await boot(
    deploymentOf(kind, { factory: watching(kind, watched), ...deployment }),
    over,
  );
  const backend = await runtime.control.createBackend({
    name: 'b',
    app: deployment.apps?.[0]?.id ?? 'library',
    placement: 'main',
  });
  const created = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
  const tenantRef = { name: 't', id: created.id };
  const operator: Carrier = {
    transport: 'cli',
    headers: { 'x-tenant': created.id },
    local: { inProcess: true },
  };
  const signal = new AbortController().signal;
  const invoke = (action: string, input: unknown, carrier: Carrier, commandId?: string) =>
    runtime.invoker.invoke({
      action,
      input,
      carrier,
      requestId: crypto.randomUUID(),
      signal,
      ...(commandId === undefined ? {} : { commandId }),
    });
  const explain = async (request: Record<string, unknown>) => {
    const outcome = await invoke(
      'core.explain',
      { backend: backend.id, tenant: created.id, ...request },
      operator,
    );
    return outcome.ok
      ? { ok: true as const, value: outcome.value as Answer }
      : { ok: false as const, error: outcome.error, value: undefined as unknown as Answer };
  };
  const asAda = testCarrier(tenantRef, ada);
  /** What each store holds: the event head of every scope level seen, and the books of the tenant. */
  const books = runtime
    .registry(deployment.apps?.[0]?.id ?? 'library')
    .entities.get('library.book')?.descriptor;
  const stores = async (commandId?: string) => {
    const found: Record<string, unknown> = {};
    for (const [key, { adapter, namespace, scope }] of watched.seen) {
      // The workers' own units (promote and take) run at namespace scope: they hold no events, receipts or rows.
      if (scope.level === 'namespace') continue;
      found[key] = await adapter.unit(
        namespace,
        scope,
        async (unit) => ({
          head: await unit.events.head(),
          receipt: commandId === undefined ? undefined : await unit.receipts.get(commandId),
          ...(scope.level === 'tenant' && books !== undefined
            ? { books: (await unit.rows.find(books, {})).rows }
            : {}),
        }),
        { readOnly: true },
      );
    }
    return found;
  };
  return { runtime, invoke, explain, asAda, operator, stores, watched };
}

export function dry(registry: ReturnType<typeof registryWith>, ref: string, over: object = {}) {
  const adapter = open([bookEntity, loanEntity, effectEntity]);
  const action = registry.actions.get(ref);
  if (action === undefined) throw new Error(`no ${ref}`);
  return {
    adapter,
    run: () =>
      dryRun({
        registry,
        adapter,
        namespace,
        scope: tenant,
        action,
        input: {},
        principal: userOf('ada'),
        request: { transport: 'test', requestId: 'r1' },
        clock,
        keys: deriveOnlyKeys,
        compute: {} as never,
        log: silent,
        trace: {} as never,
        rules: [...registry.rules.values()].filter((r) => r.disabled !== true).map(normalizeRule),
        apiVersion: '2026-11-04',
        build: { id: 'test', revision: 1 },
        behaviours,
        commandId: 'dry-1',
        ...over,
      }),
  };
}
