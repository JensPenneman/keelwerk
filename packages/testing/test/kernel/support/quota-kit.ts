import type { Carrier, Invoker, Logger, QuotaLimits } from '@keelwerk/core';
import {
  createControlQuotas,
  createQuotaCache,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  quota,
  readBackendQuotas,
  shape,
} from '@keelwerk/core';
import { onTestFinished } from 'vitest';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';

const note = defineEntity({ prefix: 'note', fields: { text: field.string({ maxLength: 80 }) } });
const notesBase = defineModuleBase({
  id: 'notes',
  version: '0.1.0',
  entities: { note },
  quotas: {
    noteBytes: quota.bytes().default('1MiB'),
    backendNotes: quota.count().default(50, { level: 'backend' }),
  },
});

const addNote = defineCommand(notesBase, {
  input: shape({ text: field.string({ maxLength: 80 }) }),
  output: shape({ id: field.ref.own('note') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(note);
    return { events: [ctx.write.notes.note.create({ id, text: input.text })], result: { id } };
  },
});

const notes = defineModule(notesBase, {
  actions: { addNote },
  policies: {
    addNote: { open: defineRule(notesBase, addNote, { effect: 'allow', principal: 'user' }) },
  },
});

const app = defineApp({ id: 'quota-app', modules: [notes] as const });

/** The in-process operator of the local socket: deployment scope, the operator principal. */
const operatorCarrier: Carrier = { transport: 'test', local: { inProcess: true } };

type Booted = TestRuntime<typeof app, 'acme' | 'globex'>;

export async function bootQuotas(options: TestRuntimeOptions = {}) {
  const runtime = await startTestRuntime(app, {
    operators: true,
    tenants: ['acme', 'globex'],
    ...options,
  });
  onTestFinished(() => runtime.stop());
  return runtime;
}

/** `core.quota.set` over the in-process operator carrier, with a command id. */
export function setQuota(runtime: { readonly invoker: Invoker }, input: unknown) {
  return runtime.invoker.invoke<unknown, { id: string; version: number }>({
    action: 'core.quota.set',
    input,
    carrier: operatorCarrier,
    requestId: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

/** One call as the tenant's user. */
export function callNotesAs(
  runtime: Booted,
  tenant: 'acme' | 'globex',
  action: string,
  input: unknown = {},
) {
  return runtime.invoker.invoke<unknown, Record<string, unknown>>({
    action,
    input,
    carrier: testCarrier(runtime.tenants[tenant], testPrincipal('ada')),
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

/** The quota cache over the runtime's control store and feed, stopped when the test ends. */
export function followQuotas(
  runtime: Booted,
  queues?: Parameters<typeof createQuotaCache>[0]['queues'],
): { readonly limits: QuotaLimits; readonly errors: readonly string[] } {
  const errors: string[] = [];
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message) => {
      errors.push(message);
    },
    child: () => log,
  };
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  const limits = createQuotaCache({
    quotas: createControlQuotas({
      adapter: runtime.control.adapter,
      namespace: runtime.control.namespace,
      registry: runtime.app.registry,
    }),
    backendQuotas: () =>
      readBackendQuotas({
        adapter: runtime.control.adapter,
        namespace: runtime.control.namespace,
        registry: runtime.app.registry,
      }),
    queues,
    clock: runtime.clock,
    log,
    signal: controller.signal,
  });
  return { limits, errors };
}

/** The core.quota row and the events of its stream, straight from the control store (not through an action). */
export function storedQuota(runtime: Booted, id: string) {
  const descriptor = runtime.app.registry.entities.get('core.quota')?.descriptor;
  if (descriptor === undefined) throw new Error('core.quota is not registered');
  const { adapter, namespace } = runtime.control;
  return adapter.unit(namespace, { level: 'deployment' }, async (unit) => ({
    row: (await unit.rows.find(descriptor, { where: { op: 'eq', field: 'id', value: id } }))
      .rows[0],
    events: await unit.events.readStream({ type: 'core.quota', id }),
  }));
}

/** Every core.backend row, straight from the control store, sorted by name. */
export function storedBackends(runtime: Booted) {
  const descriptor = runtime.app.registry.entities.get('core.backend')?.descriptor;
  if (descriptor === undefined) throw new Error('core.backend is not registered');
  const { adapter, namespace } = runtime.control;
  return adapter.unit(namespace, { level: 'deployment' }, async (unit) =>
    (await unit.rows.find(descriptor, { includeArchived: true })).rows.toSorted((a, b) =>
      String(a.name).localeCompare(String(b.name)),
    ),
  );
}
