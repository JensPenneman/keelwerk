import type { Scope, StorageRow } from '@keelwerk/core';
import { deriveEffectId } from '@keelwerk/core';
import { httpHost } from '@keelwerk/transport-http';
import { afterEach } from 'vitest';
import { readEventStream } from '../../../src/conformance/transport/read-event-stream.ts';
import type { LoggedLine } from '../../../src/harness/logged-line.ts';
import { recordingLogger } from '../../../src/harness/recording-logger.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import { testPrincipalHeader } from '../../../src/harness/test-principal-header.ts';
import { dispatchApp, dispatchUrl } from './dispatch-app.ts';

/** The data subject of every parcel a test sends: fixed, because a decision must give the same effect on every run. */
const parcelOwner = '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e61';

/** A runtime over the dispatch app with workers, the HTTP host and two tenants, and the calls a test makes of it. */
async function startDispatch(adapter: 'memory' | 'pglite') {
  const lines: LoggedLine[] = [];
  const runtime = await startTestRuntime(dispatchApp, {
    adapter,
    host: httpHost(),
    workers: true,
    operators: true,
    tenants: ['acme', 'globex'],
    logger: recordingLogger(lines),
  });
  const acme = runtime.tenants.acme;
  const scopeOf = (tenant: typeof acme): Scope => ({
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: tenant.id,
  });
  const call = async (
    action: string,
    input: unknown,
    options: { as?: string; tenant?: typeof acme; commandId?: string } = {},
  ) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action,
      input,
      carrier: testCarrier(options.tenant ?? acme, testPrincipal(options.as ?? 'ada')),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: options.commandId ?? crypto.randomUUID(),
    });
  const follow = async (
    depot: string,
    options: { as?: string; tenant?: typeof acme; lastEventId?: string } = {},
  ) =>
    readEventStream(
      await runtime.fetch(
        new Request(
          `${dispatchUrl}/_keelwerk/v1/subscribe?action=dispatch.pending&input=${encodeURIComponent(JSON.stringify({ depot }))}`,
          {
            headers: {
              'x-tenant': (options.tenant ?? acme).id,
              [testPrincipalHeader]: JSON.stringify({
                subject: options.as ?? 'courier',
                roles: [],
                claims: {},
              }),
              ...(options.lastEventId === undefined
                ? {}
                : { 'last-event-id': options.lastEventId }),
            },
          },
        ),
      ),
    );
  const headersOf = (options: { as?: string; tenant?: typeof acme; lastEventId?: string }) => ({
    'x-tenant': (options.tenant ?? acme).id,
    [testPrincipalHeader]: JSON.stringify({
      subject: options.as ?? 'courier',
      roles: [],
      claims: {},
    }),
    ...(options.lastEventId === undefined ? {} : { 'last-event-id': options.lastEventId }),
  });
  /** An action over the protocol's HTTP endpoint: the status and the raw body text. */
  const post = async (
    action: string,
    input: unknown,
    options: { as?: string; tenant?: typeof acme } = {},
  ) => {
    const response = await runtime.fetch(
      new Request(`${dispatchUrl}/_keelwerk/v1/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headersOf({ as: 'ada', ...options }) },
        body: JSON.stringify({ action, input }),
      }),
    );
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) as unknown };
  };
  /** A subscription over HTTP read as raw event-stream text until its `head` (or its end); the bytes, not parsed frames. */
  const rawWatch = async (
    action: string,
    input: unknown,
    options: { as?: string; tenant?: typeof acme; lastEventId?: string; stopAfter?: string } = {},
  ) => {
    const response = await runtime.fetch(
      new Request(
        `${dispatchUrl}/_keelwerk/v1/subscribe?action=${action}&input=${encodeURIComponent(JSON.stringify(input))}`,
        { headers: headersOf(options) },
      ),
    );
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    const stop = options.stopAfter ?? 'event: head';
    let text = '';
    for (let rounds = 0; rounds < 50 && !text.includes(stop); rounds += 1) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    await reader?.cancel();
    return { status: response.status, text };
  };
  /** The id of the effect the `index`-th effect of a command requested. */
  const effectOf = (commandId: string, tenant = acme) =>
    deriveEffectId(scopeOf(tenant), commandId, 0);
  const rows = (entity: string, tenant = acme): Promise<readonly StorageRow[]> => {
    const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
    if (descriptor === undefined) throw new Error(`no entity ${entity}`);
    return runtime.sealed.unit(
      runtime.namespace,
      scopeOf(tenant),
      async (unit) => (await unit.rows.find(descriptor, {})).rows,
    );
  };
  const sent = async (
    over: Record<string, unknown> = {},
    options: { as?: string; tenant?: typeof acme } = {},
  ) => {
    const commandId = crypto.randomUUID();
    const outcome = await call(
      'dispatch.send',
      { owner: parcelOwner, parcel: 'p-1', depot: 'north', recipient: 'ada@example.org', ...over },
      { ...options, commandId },
    );
    return { commandId, outcome, id: effectOf(commandId, options.tenant) };
  };
  return { runtime, lines, acme, call, post, rawWatch, follow, effectOf, rows, sent, scopeOf };
}

/** What `startDispatch` answers. */
export type DispatchRuntime = Awaited<ReturnType<typeof startDispatch>>;

/** The kinds of change an effect's stream went through. */
export async function changesOf(booted: DispatchRuntime, id: string): Promise<readonly string[]> {
  const events = await booted.runtime.adapter.unit(
    booted.runtime.namespace,
    booted.scopeOf(booted.acme),
    (unit) => unit.events.readStream({ type: 'core.effect', id }),
  );
  return events.map((event) => event.type);
}

/** An instant `ms` after the runtime's clock. */
export function dispatchSoon(booted: DispatchRuntime, ms = 3_600_000): Temporal.Instant {
  return booted.runtime.clock.now().add({ milliseconds: ms });
}

/** Starts a runtime per test over `adapter`; it is stopped after the test. */
export function dispatchRuntime(adapter: 'memory' | 'pglite') {
  const stops: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) await stop();
  });
  return {
    start: async (): Promise<DispatchRuntime> => {
      const booted = await startDispatch(adapter);
      stops.push(() => booted.runtime.stop());
      return booted;
    },
  };
}
