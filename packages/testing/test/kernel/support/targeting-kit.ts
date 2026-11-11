import type { Carrier, Invoker, StoredEvent } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEntity,
  defineFlag,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';
import { onTestFinished } from 'vitest';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import { tenantAddress } from '../../../src/replay/tenant-address.ts';

const note = defineEntity({ prefix: 'note', fields: { text: field.string({ maxLength: 80 }) } });
const rolloutBase = defineModuleBase({
  id: 'rollout',
  version: '0.1.0',
  entities: { note },
  flags: {
    beta: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'release',
      expires: '2027-06-30',
    }),
    layout: defineFlag({
      kind: 'variant',
      variants: ['control', 'compact'],
      default: 'control',
      level: 'principal',
      purpose: 'experiment',
      expires: '2027-06-30',
      client: true,
    }),
    hidden: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'release',
      expires: '2027-06-30',
      client: false,
    }),
  },
});

const readBeta = defineCommand(rolloutBase, {
  input: shape({ text: field.string({ maxLength: 80 }) }),
  output: shape({ beta: field.boolean() }),
  principal: 'user',
  *decide(input, ctx) {
    const beta = yield* ctx.flags.rollout.beta;
    const id = yield* ctx.newId(note);
    return {
      events: [ctx.write.rollout.note.create({ id, text: input.text })],
      result: { beta },
    };
  },
});

const rollout = defineModule(rolloutBase, {
  actions: { readBeta },
  policies: {
    readBeta: { open: defineRule(rolloutBase, readBeta, { effect: 'allow', principal: 'user' }) },
  },
});

const app = defineApp({ id: 'rollout-app', modules: [rollout] as const });

/** The in-process operator of the local socket: deployment scope, the operator principal. */
const operatorCarrier: Carrier = { transport: 'test', local: { inProcess: true } };

const ada = testPrincipal('ada');
type Booted = TestRuntime<typeof app, 'acme' | 'globex'>;

export async function bootTargeting(options: TestRuntimeOptions = {}) {
  const runtime = await startTestRuntime(app, {
    operators: true,
    tenants: ['acme', 'globex'],
    ...options,
  });
  onTestFinished(() => runtime.stop());
  return runtime;
}

/** One call as the tenant's user, or as an anonymous caller with the given client id. */
export function callAs(
  runtime: Booted,
  tenant: 'acme' | 'globex',
  action: string,
  input: unknown = {},
  options: { readonly anonymous?: boolean; readonly clientId?: string } = {},
) {
  const base = testCarrier(
    runtime.tenants[tenant],
    options.anonymous === true ? testPrincipal(null) : ada,
  );
  const carrier: Carrier =
    options.clientId === undefined
      ? base
      : { ...base, headers: { ...base.headers, 'keelwerk-client-id': options.clientId } };
  return runtime.invoker.invoke<unknown, Record<string, unknown>>({
    action,
    input,
    carrier,
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

/** `core.flag.set` over the in-process operator carrier. */
export function setFlag(runtime: { readonly invoker: Invoker }, input: unknown) {
  return runtime.invoker.invoke<unknown, { id: string; ruleVersion: number }>({
    action: 'core.flag.set',
    input,
    carrier: operatorCarrier,
    requestId: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

/** Any core action over the in-process operator carrier. */
export function asOperator(runtime: { readonly invoker: Invoker }, action: string, input: unknown) {
  return runtime.invoker.invoke<unknown, Record<string, unknown>>({
    action,
    input,
    carrier: operatorCarrier,
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

/** Every event the tenant's stream holds, the ones `meta.flags` records included. */
export function flagEventsOf(
  runtime: Booted,
  tenant: 'acme' | 'globex',
): Promise<readonly StoredEvent[]> {
  const address = tenantAddress(runtime, tenant);
  return runtime.adapter.unit(address.namespace, address.scope, async (unit) => {
    const found: StoredEvent[] = [];
    let after: bigint | null = null;
    for (;;) {
      const batch = await unit.events.readAll(after, { limit: 500, includeTransient: true });
      found.push(...batch.events);
      if (batch.next === null || batch.events.length === 0) return found;
      after = batch.next;
    }
  });
}

/** The core.flag row and the events of its stream, straight from the control store (not through an action). */
export function storedFlag(runtime: Booted, id: string) {
  const descriptor = runtime.app.registry.entities.get('core.flag')?.descriptor;
  if (descriptor === undefined) throw new Error('core.flag is not registered');
  const { adapter, namespace } = runtime.control;
  return adapter.unit(namespace, { level: 'deployment' }, async (unit) => ({
    row: (await unit.rows.find(descriptor, { where: { op: 'eq', field: 'id', value: id } }))
      .rows[0],
    events: await unit.events.readStream({ type: 'core.flag', id }),
  }));
}
