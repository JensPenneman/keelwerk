import type { FlagResolution, StoredEvent } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEntity,
  defineFlag,
  defineModule,
  defineModuleBase,
  defineQuery,
  defineRule,
  field,
  invoke,
  shape,
} from '@keelwerk/core';
import { onTestFinished } from 'vitest';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import type { TestApp } from '../../../src/harness/test-app.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import { tenantAddress } from '../../../src/replay/tenant-address.ts';

const note = defineEntity({ prefix: 'note', fields: { text: field.string({ maxLength: 80 }) } });
const gatesBase = defineModuleBase({
  id: 'gates',
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
    live: defineFlag({
      kind: 'boolean',
      default: true,
      level: 'deployment',
      purpose: 'kill-switch',
    }),
  },
});

const record = defineCommand(gatesBase, {
  input: shape({ text: field.string({ maxLength: 80 }) }),
  output: shape({ noteId: field.ref.own('note'), beta: field.boolean() }),
  principal: 'user',
  *decide(input, ctx) {
    const beta = yield* ctx.flags.gates.beta;
    const id = yield* ctx.newId(note);
    return {
      events: [ctx.write.gates.note.create({ id, text: input.text })],
      result: { noteId: id, beta },
    };
  },
});
const suspendable = defineCommand(gatesBase, {
  gate: 'live',
  input: shape({}),
  output: shape({ ran: field.boolean() }),
  principal: 'user',
  decide: () => ({ events: [], result: { ran: true } }),
});
const guarded = defineCommand(gatesBase, {
  input: shape({}),
  output: shape({ ran: field.boolean() }),
  principal: 'user',
  decide: () => ({ events: [], result: { ran: true } }),
});
const relay = defineCommand(gatesBase, {
  input: shape({}),
  output: shape({ relayed: field.boolean() }),
  principal: 'user',
  decide: () => ({ events: [], effects: [invoke(guarded, {})], result: { relayed: true } }),
});
const detail = defineQuery(gatesBase, {
  input: shape({}),
  output: shape({ reason: field.string(), errorCode: field.string(), provider: field.string() }),
  principal: 'user',
  *read(_input, ctx) {
    const resolution: FlagResolution<unknown> = yield* ctx.flagDetails('gates.beta');
    return {
      reason: resolution.reason,
      errorCode: resolution.errorCode ?? '',
      provider: resolution.provider,
    };
  },
});
const gates = defineModule(gatesBase, {
  actions: { record, suspendable, guarded, relay, detail },
  policies: {
    record: { open: defineRule(gatesBase, record, { effect: 'allow', principal: 'user' }) },
    suspendable: {
      open: defineRule(gatesBase, suspendable, { effect: 'allow', principal: 'user' }),
    },
    guarded: {
      whenBeta: defineRule(gatesBase, guarded, {
        effect: 'allow',
        principal: 'user',
        when: (ctx) => ctx.flags.gates?.beta === true,
      }),
    },
    relay: { open: defineRule(gatesBase, relay, { effect: 'allow', principal: 'user' }) },
    detail: { open: defineRule(gatesBase, detail, { effect: 'allow', principal: 'user' }) },
    note: {
      // The beta flag widens what a reader sees, so the rows and the state token both depend on it.
      readers: defineRule(gatesBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.flags.gates?.beta === true ? {} : { text: 'public' }),
      }),
    },
  },
});

const wallBase = defineModuleBase({
  id: 'walled',
  version: '0.1.0',
  flags: {
    open: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'release',
      expires: '2027-06-30',
    }),
  },
  gate: 'open',
});
const touch = defineCommand(wallBase, {
  input: shape({}),
  output: shape({ ran: field.boolean() }),
  principal: 'user',
  decide: () => ({ events: [], result: { ran: true } }),
});
const peek = defineQuery(wallBase, {
  input: shape({}),
  output: shape({ ran: field.boolean() }),
  principal: 'user',
  read: () => ({ ran: true }),
});
const walled = defineModule(wallBase, {
  actions: { touch, peek },
  policies: {
    touch: { open: defineRule(wallBase, touch, { effect: 'allow', principal: 'user' }) },
    peek: { open: defineRule(wallBase, peek, { effect: 'allow', principal: 'user' }) },
  },
});

const app = defineApp({ id: 'flags-app', modules: [gates, walled] as const });

const ada = testPrincipal('ada');

/** An environment of the given variables; their names are not camel case, so they go in as data. */
export function variables(
  ...pairs: readonly (readonly [string, string])[]
): Record<string, string> {
  return Object.fromEntries(pairs);
}

export async function bootFlags(app: TestApp, options: TestRuntimeOptions = {}) {
  const runtime = await startTestRuntime(app, { tenants: ['acme'], ...options });
  onTestFinished(() => runtime.stop());
  const address = tenantAddress(runtime);
  const call = <O = unknown>(action: string, input: unknown, commandId?: string) =>
    runtime.invoker.invoke<unknown, O>({
      action,
      input,
      carrier: testCarrier(address.tenant, ada),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      ...(commandId === undefined ? {} : { commandId }),
    });
  const events = (): Promise<readonly StoredEvent[]> =>
    runtime.adapter.unit(address.namespace, address.scope, async (unit) => {
      const found: StoredEvent[] = [];
      let after: bigint | null = null;
      for (;;) {
        const batch = await unit.events.readAll(after, { limit: 500, includeTransient: true });
        found.push(...batch.events);
        if (batch.next === null || batch.events.length === 0) return found;
        after = batch.next;
      }
    });
  return { runtime, call, events };
}

export const flagsApp: typeof app = app;
