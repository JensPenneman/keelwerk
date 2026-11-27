import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { DataAdapterFactory, Scope, Unit } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { afterAll, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { watching } from './support/watching.ts';

const member = defineEntity({
  prefix: 'zlm',
  dataSubject: 'id',
  fields: { email: field.string().personal(), note: field.string().optional() },
});
const base = defineModuleBase({ id: 'lock', version: '0.1.0', entities: { member } });
const enrol = defineCommand(base, {
  input: shape({ email: field.string() }),
  output: shape({ id: field.ref.own('member') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(member);
    return { events: [ctx.write.lock.member.create({ id, email: input.email })], result: { id } };
  },
});
/** An asynchronous command of the member on her own row: its job claims its receipt, then loads the row. */
const touch = defineCommand(base, {
  input: shape({ id: field.ref.own('member') }),
  principal: 'user',
  execution: 'async',
  *decide(input, ctx) {
    const row = yield* ctx.load.lock.member.one({ where: { id: input.id } });
    return row === undefined ? [] : [ctx.write.lock.member.update(row, { note: 'touched' })];
  },
});
const lock = defineModule(base, {
  actions: { enrol, touch },
  policies: {
    enrol: { operator: defineRule(base, enrol, { effect: 'allow', principal: 'operator' }) },
    touch: { user: defineRule(base, touch, { effect: 'allow', principal: 'user' }) },
  },
});
const lockApp = defineApp({ id: 'erasure-lock-order', modules: [lock] });

const gate = {
  commandId: '',
  subject: '',
  armed: false,
  jobFailed: false,
  claimed: Promise.withResolvers<void>(),
  rowDone: Promise.withResolvers<void>(),
};

/**
 * The adapter of `inner` whose tenant units park the job of the command after it claimed its
 * receipt, until the unit of the erasure that visits the row has committed: a command takes its
 * receipt first and its row second, so a unit of the erasure that held the row's lock and then
 * waited for the receipt would never commit, and the job would never go on.
 */
function parkingJob(inner: DataAdapterFactory): DataAdapterFactory {
  return {
    ...inner,
    create: (placement, env) => {
      const adapter = inner.create(placement, env);
      return {
        ...adapter,
        unit: (namespace, scope, fn, options) =>
          adapter.unit(
            namespace,
            scope,
            async (unit) => {
              if (scope.level !== 'tenant') return fn(unit);
              let parked = false;
              try {
                return await fn(
                  watching(unit, {
                    receipts: watching(unit.receipts, {
                      claim: async (...args: Parameters<Unit['receipts']['claim']>) => {
                        const answer = await unit.receipts.claim(...args);
                        // The job's claim finds the receipt of the accepted command; the accepting unit's claim made it.
                        if (
                          gate.armed &&
                          args[0].commandId === gate.commandId &&
                          answer === 'exists'
                        ) {
                          gate.armed = false;
                          parked = true;
                          gate.claimed.resolve();
                          await gate.rowDone.promise;
                        }
                        return answer;
                      },
                    }),
                  }),
                );
              } catch (error) {
                // The job's unit ended by an error: its connection was ended while it waited, or the database ended it.
                if (parked) gate.jobFailed = true;
                throw error;
              }
            },
            options,
          ),
      };
    },
  };
}

const stops: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.allSettled(stops.splice(0).map((stop) => stop()));
});

test('the units of an erasure that purge a principal take the locks in the order of a command, so a job of the erased subject that holds its receipt is not deadlocked', {
  timeout: 120_000,
}, async () => {
  const database = await createTestDatabase('erasure_lock_order');
  const worker = erasure({
    pollMs: 3_600_000,
    afterStep: async (step) => {
      if (step === 'streams') gate.rowDone.resolve();
    },
  });
  const runtime = await startTestRuntime(lockApp, {
    external: {
      factory: parkingJob(postgresAdapter({ ownerUrl: database.adminUrl })),
      url: database.appUrl,
    },
    operators: true,
    workers: true,
    tenants: ['acme'],
    eventWorkers: [worker],
  });
  stops.push(() => runtime.stop());
  const scope: Scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const ada = String(
    ((await operator.invoke('lock.enrol', { email: 'ada@example.test' })) as { id: string }).id,
  );
  gate.subject = ada;
  await operator.invoke(
    'core.eraseSubject',
    { subjectId: ada as never, reason: 'subjectRequest' } as never,
    { prefer: 'async' },
  );
  await runtime.drainJobs();

  // Her command is accepted, and its job claims the receipt and waits there for the erasure's row unit.
  const asAda = createLocalClient(runtime, { principal: testPrincipal(ada), tenant: 'acme' });
  gate.commandId = crypto.randomUUID();
  gate.armed = true;
  await asAda.attempt('lock.touch', { id: ada as never }, {
    prefer: 'async',
    commandId: gate.commandId,
  } as never);
  await gate.claimed.promise;
  expect(await worker.pass()).toBeGreaterThan(0);
  await runtime.drainJobs();

  // The erasure finished, and no unit was ended by a deadlock (the connection guard of the project checks the counter of the file).
  const receipt = await runtime.adapter.unit(runtime.namespace, scope, (unit) =>
    unit.receipts.get(gate.commandId),
  );
  expect(receipt).toBeUndefined();
  // The job went on to its end: the erasure held nothing it waited for.
  expect(gate.jobFailed).toBe(false);
});
