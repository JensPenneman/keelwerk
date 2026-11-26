import type { Carrier, Clock } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  invoke,
  shape,
} from '@keelwerk/core';
import { httpHost } from '@keelwerk/transport-http';
import { rest } from '@keelwerk/transport-rest';
import { pinnedLiveTimers } from '../../../src/harness/pinned-live-timers.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import { testPrincipalHeader } from '../../../src/harness/test-principal-header.ts';

/** What the commands of the app below ran, in order. */
const ran: string[] = [];

const base = defineModuleBase({ id: 'probe', version: '0.1.0' });
const input = shape({ n: field.integer() });
const run = (name: string) => (given: { readonly n: number }) => {
  ran.push(`${name}:${given.n}`);
  return [];
};
const sweep = defineCommand(base, {
  input,
  principal: 'user',
  internal: true,
  decide: run('sweep'),
});
const sweepOpen = defineCommand(base, { input, principal: 'user', decide: run('open') });
const sweepLater = defineCommand(base, {
  input,
  principal: 'user',
  internal: true,
  execution: 'async',
  decide: run('later'),
});
const otherBase = defineModuleBase({ id: 'other', version: '0.1.0' });
const poke = defineCommand(otherBase, {
  principal: 'user',
  decide: () => ({
    events: [],
    effects: [invoke('probe.sweep', { n: 7 }), invoke('probe.sweepLater', { n: 8 })],
  }),
});
const probe = defineModule(base, {
  actions: { sweep, sweepOpen, sweepLater },
  policies: {
    sweep: { users: defineRule(base, sweep, { effect: 'allow', principal: 'user' }) },
    sweepOpen: { users: defineRule(base, sweepOpen, { effect: 'allow', principal: 'user' }) },
    sweepLater: { users: defineRule(base, sweepLater, { effect: 'allow', principal: 'user' }) },
  },
});
const other = defineModule(otherBase, {
  actions: { poke },
  policies: {
    poke: { users: defineRule(otherBase, poke, { effect: 'allow', principal: 'user' }) },
  },
});
const app = defineApp({ id: 'probing', modules: [probe, other, rest] });

const url = 'https://probing.example.test';

/** The app with internal commands, booted behind the http host with workers and operators. */
async function bootInternalApp() {
  let now = Temporal.Instant.from('2026-11-12T10:00:00Z');
  const clock: Clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  const runtime = await startTestRuntime(app, {
    clock,
    timers,
    host: httpHost(),
    workers: true,
    operators: true,
    tenants: ['acme'],
    config: { rest: { docs: false, cors: [] } },
  });
  ran.length = 0;
  const operator: Carrier = { transport: 'test', local: { inProcess: true } };
  /** The requests the admission stage has counted so far, after the first flush of the counts. */
  const counted = async (): Promise<number> => {
    now = now.add({ seconds: 61 });
    await timers.fire();
    const outcome = await runtime.invoker.invoke<unknown, { items: readonly { count: number }[] }>({
      action: 'core.apiUsage',
      input: { since: '2026-11-01', until: '2026-12-31' },
      carrier: operator,
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value.items.reduce((sum, row) => sum + Number(row.count), 0);
  };
  return Object.assign(runtime, { counted });
}

type InternalRuntime = Awaited<ReturnType<typeof bootInternalApp>>;

/** The headers of a call of the user ada, or of an anonymous caller, to the tenant acme. */
const headersOf = (runtime: InternalRuntime, signedIn: boolean): Record<string, string> => ({
  'content-type': 'application/json',
  'x-tenant': runtime.tenants.acme?.id ?? '',
  ...(signedIn ? { [testPrincipalHeader]: JSON.stringify(testPrincipal('ada')) } : {}),
});

/** One request through the http host: status, every header but the ones that vary, and the body. */
async function send(runtime: InternalRuntime, path: string, body: unknown, signedIn: boolean) {
  const response = await runtime.fetch(
    new Request(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: headersOf(runtime, signedIn),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  const text = await response.text();
  const headers = [...response.headers.entries()]
    .filter(([name]) => !/^(date|x-request-id|traceparent|server-timing)$/i.test(name))
    .sort();
  const body2 = text
    .replace(/"requestId":"[^"]*"/g, '"requestId":"x"')
    .replace(/urn:uuid:[0-9a-f-]+/g, 'urn:uuid:x');
  return { status: response.status, headers, body: body2 };
}

/** The answer with one reference put for another, in the body and in the headers. */
const asIf = (answer: Awaited<ReturnType<typeof send>>, from: string, to: string) => ({
  ...answer,
  body: answer.body.replaceAll(from, to),
  headers: answer.headers.map(([name, value]) => [name, value.replaceAll(from, to)]),
});

export type { InternalRuntime };
export { asIf, bootInternalApp, headersOf, ran, send, url };
