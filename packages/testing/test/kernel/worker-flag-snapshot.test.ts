import type { Clock, Scope, StoredJobSpec } from '@keelwerk/core';
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
import { afterAll, describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';

const note = defineEntity({ prefix: 'note', fields: { text: field.string({ maxLength: 80 }) } });
const queuedBase = defineModuleBase({
  id: 'queued',
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
  },
});
const record = defineCommand(queuedBase, {
  gate: 'beta',
  execution: 'async',
  input: shape({ text: field.string({ maxLength: 80 }) }),
  output: shape({ noteId: field.ref.own('note') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(note);
    return {
      events: [ctx.write.queued.note.create({ id, text: input.text })],
      result: { noteId: id },
    };
  },
});
const queued = defineModule(queuedBase, {
  actions: { record },
  policies: {
    record: { open: defineRule(queuedBase, record, { effect: 'allow', principal: 'user' }) },
  },
});
const app = defineApp({ id: 'queued-app', modules: [queued] as const });

const at = Temporal.Instant.from('2026-03-01T08:00:00Z');
const clock: Clock = { now: () => at };
const gate = 'KEELWERK_FLAG_QUEUED_BETA';
const variables: Record<string, string | undefined> = Object.fromEntries([[gate, 'true']]);
const ada = testPrincipal('ada');

// Only the queue `held` is worked, so the job the command's acceptance queued waits and the test
// puts a second job for the same command into `held` once the gate is where it wants it.
const runtime = await startTestRuntime(app, {
  tenants: ['acme'],
  clock,
  env: variables,
  workers: { queues: ['held'] },
});
afterAll(() => runtime.stop());
const { acme } = runtime.tenants;
const scope: Scope = { level: 'tenant', backendId: runtime.backendId, tenantId: acme.id };

async function accept(commandId: string) {
  return runtime.invoker.invoke({
    action: 'queued.record',
    input: { text: commandId },
    carrier: testCarrier(acme, ada),
    requestId: crypto.randomUUID(),
    commandId,
    prefer: 'async',
    signal: new AbortController().signal,
  });
}

async function queueJob(commandId: string) {
  const spec: StoredJobSpec = {
    kind: 'action',
    queue: 'held',
    run: { action: 'queued.record', input: { text: commandId }, commandId },
    scope: scope as StoredJobSpec['scope'],
    principal: { resolver: 'test.principal', principalId: 'ada' },
    causation: { commandId },
    build: { id: 'test-build', revision: 1 },
    laneCap: 4,
    createdAt: at,
  };
  await runtime.adapter.unit(runtime.namespace, scope, (unit) => unit.jobs.enqueue(spec));
}

async function receiptOf(commandId: string) {
  return runtime.adapter.unit(runtime.namespace, scope, (unit) => unit.receipts.get(commandId));
}

async function noteCount(): Promise<number> {
  return runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
    const batch = await unit.events.readAll(null, { limit: 500, includeTransient: true });
    return batch.events.filter((event) => event.type === 'queued.note.created').length;
  });
}

describe('a queued job takes a fresh flag snapshot when its worker runs it', () => {
  test('a gate closed after acceptance refuses the job as an external call is refused, and writes no note event', async () => {
    expect(await accept('gated-1')).toMatchObject({ ok: true, receipt: { status: 'accepted' } });
    const before = await noteCount();
    variables[gate] = 'false';
    await queueJob('gated-1');
    expect(await runtime.drainJobs()).toBe(1);
    expect(await noteCount()).toBe(before);
    expect(await receiptOf('gated-1')).toMatchObject({
      status: 'failed',
      outcome: {
        ok: false,
        error: { kind: 'forbidden', code: 'core.feature_disabled' },
      },
    });
    const external = await runtime.invoker.invoke({
      action: 'queued.record',
      input: { text: 'external' },
      carrier: testCarrier(acme, ada),
      requestId: crypto.randomUUID(),
      prefer: 'async',
      signal: new AbortController().signal,
    });
    expect(external).toMatchObject({
      ok: false,
      error: { kind: 'forbidden', code: 'core.feature_disabled' },
    });
  });

  test('with the gate open when the worker runs, the job runs and appends its event', async () => {
    variables[gate] = 'true';
    expect(await accept('gated-2')).toMatchObject({ ok: true, receipt: { status: 'accepted' } });
    const before = await noteCount();
    await queueJob('gated-2');
    expect(await runtime.drainJobs()).toBe(1);
    expect(await noteCount()).toBe(before + 1);
    expect(await receiptOf('gated-2')).toMatchObject({ status: 'completed' });
  });
});
