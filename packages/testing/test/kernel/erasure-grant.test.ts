import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { dumpDatabase } from '../../src/index.ts';
import { pgliteQuery, sectionsOf } from './support/dump-sections.ts';
import {
  erasureAddedApp,
  erasureHeldApp,
  erasureLinkedApp,
  erasureReleasedApp,
  erasureStrangerApp,
} from './support/erasure-grant-apps.ts';
import type { erasureDumpApp } from './support/erasure-probe-module.ts';
import { bootErasureRules, ledgerOf, stopBooted } from './support/erasure-rules-kit.ts';

afterEach(stopBooted);

const reason = 'subjectRequest';

/** What an accepted erasure would have written in the tenant: its receipt, which its job is written with in one unit. */
async function writtenIn(runtime: TestRuntime<typeof erasureDumpApp>) {
  const acme = runtime.tenants.acme;
  if (acme === undefined) throw new Error('no acme tenant');
  const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: acme.id } as const;
  const receipts = runtime.app.registry.entities.get('core.commandReceipt')?.descriptor;
  if (receipts === undefined) throw new Error('no receipt entity');
  return runtime.sealed.unit(
    runtime.namespace,
    scope,
    async (unit) => ({
      receipts: (
        await unit.rows.find(receipts, {
          where: { op: 'eq', field: 'action', value: 'core.eraseSubject' },
        })
      ).rows.length,
    }),
    { readOnly: true },
  );
}

describe('who may erase: the contribution and the ownership it needs (14.7.5)', () => {
  test('a user erases their own subject through the rule the probe contributed', {
    timeout: 60_000,
  }, async () => {
    const { runtime, worker, subject } = await bootErasureRules();
    const own = createLocalClient(runtime, { principal: testPrincipal(subject), tenant: 'acme' });
    const accepted = await own.invoke(
      'core.eraseSubject',
      { subjectId: subject, reason } as never,
      {
        prefer: 'async',
      },
    );
    expect(accepted).toMatchObject({ status: 'accepted' });
    await runtime.drainJobs();
    await worker.pass();
    expect((await ledgerOf(runtime)).map((entry) => entry.record.type)).toEqual([
      'erasure',
      'keyTombstone',
      'erasureCompleted',
    ]);
  });

  test('a rule whose when names another subject is forbidden', async () => {
    const { runtime, subject } = await bootErasureRules();
    const other = createLocalClient(runtime, {
      principal: testPrincipal('someone'),
      tenant: 'acme',
    });
    const outcome = await other.attempt(
      'core.eraseSubject',
      { subjectId: subject, reason } as never,
      {
        prefer: 'async',
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'forbidden' });
    expect(await ledgerOf(runtime)).toEqual([]);
  });

  test('a module that holds no row of the subject cannot grant its erasure, and nothing is written', async () => {
    const { runtime, subject } = await bootErasureRules('memory', { app: erasureStrangerApp });
    const user = createLocalClient(runtime, {
      principal: testPrincipal('someone'),
      tenant: 'acme',
    });
    const outcome = await user.attempt(
      'core.eraseSubject',
      { subjectId: subject, reason } as never,
      {
        prefer: 'async',
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'forbidden' });
    await runtime.drainJobs();
    expect(await ledgerOf(runtime)).toEqual([]);
    expect(await writtenIn(runtime)).toEqual({ receipts: 0 });
  });

  test('a subject that lives only in another tenant is forbidden from this one, and nothing is written', async () => {
    const { runtime } = await bootErasureRules();
    const globex = createLocalClient(runtime, { principal: testOperator(), tenant: 'globex' });
    const enrolled = await globex.invoke('probe.enrol', { name: 'Gil', email: 'gil@example.test' });
    const gil = String((enrolled as { personId: string }).personId);
    const user = createLocalClient(runtime, { principal: testPrincipal(gil), tenant: 'acme' });
    const outcome = await user.attempt('core.eraseSubject', { subjectId: gil, reason } as never, {
      prefer: 'async',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'forbidden' });
    expect(await ledgerOf(runtime)).toEqual([]);
    expect(await writtenIn(runtime)).toEqual({ receipts: 0 });
  });

  test('an operator needs no ownership, and neither does a rule the app added', async () => {
    const operatorBoot = await bootErasureRules();
    const unknown = crypto.randomUUID();
    const accepted = await operatorBoot.operator.invoke(
      'core.eraseSubject',
      { subjectId: unknown, reason } as never,
      { prefer: 'async' },
    );
    expect(accepted).toMatchObject({ status: 'accepted' });
    await stopBooted();
    const { runtime } = await bootErasureRules('memory', { app: erasureAddedApp });
    const user = createLocalClient(runtime, {
      principal: testPrincipal('someone'),
      tenant: 'acme',
    });
    const added = await user.invoke('core.eraseSubject', { subjectId: unknown, reason } as never, {
      prefer: 'async',
    });
    expect(added).toMatchObject({ status: 'accepted' });
  });
});

describe('a contributed rule may deny the erasure (14.7.5)', () => {
  const asOperator = async (app: typeof erasureDumpApp) => {
    const { runtime, operator, subject } = await bootErasureRules('memory', { app });
    const outcome = await operator.attempt(
      'core.eraseSubject',
      { subjectId: subject, reason: 'operator' } as never,
      { prefer: 'async' },
    );
    return { runtime, outcome };
  };

  test('a contributed deny refuses the operator, and disabling that rule lets the operator erase again', async () => {
    const held = await asOperator(erasureHeldApp);
    expect(held.outcome.ok).toBe(false);
    if (!held.outcome.ok) expect(held.outcome.error).toMatchObject({ kind: 'forbidden' });
    await held.runtime.drainJobs();
    expect(await ledgerOf(held.runtime)).toEqual([]);
    expect(await writtenIn(held.runtime)).toEqual({ receipts: 0 });
    await stopBooted();
    const released = await asOperator(erasureReleasedApp);
    expect(released.outcome.ok).toBe(true);
    await released.runtime.drainJobs();
    expect(await writtenIn(released.runtime)).toEqual({ receipts: 1 });
  });
});

describe('a contributed rule grants the erasure of a subject written in either spelling (14.7.5)', () => {
  type Operator = Awaited<ReturnType<typeof bootErasureRules>>['operator'];
  const hyphenatedOf = (compact: string): string =>
    [
      compact.slice(0, 8),
      compact.slice(8, 12),
      compact.slice(12, 16),
      compact.slice(16, 20),
      compact.slice(20),
    ].join('-');

  /** A user asks for their own erasure in `asked` spelling while the module's row holds the subject in `stored` spelling. */
  const acceptsOwnErasure = async (
    app: typeof erasureDumpApp | undefined,
    plant: (operator: Operator, stored: string) => Promise<unknown>,
    order: readonly ['compact' | 'hyphenated', 'compact' | 'hyphenated'],
  ) => {
    const { runtime, operator } = await bootErasureRules(
      'memory',
      app === undefined ? {} : { app },
    );
    const compact = crypto.randomUUID().replaceAll('-', '');
    const spelled = { compact, hyphenated: hyphenatedOf(compact) };
    const [stored, asked] = order;
    await plant(operator, spelled[stored]);
    const user = createLocalClient(runtime, {
      principal: testPrincipal(spelled[asked]),
      tenant: 'acme',
    });
    const outcome = await user.attempt(
      'core.eraseSubject',
      { subjectId: spelled[asked], reason } as never,
      { prefer: 'async' },
    );
    expect(spelled[stored]).not.toBe(spelled[asked]);
    expect(outcome.ok).toBe(true);
    // Nobody else may erase it: the control that the grant still needs the subject's own rule.
    const other = createLocalClient(runtime, {
      principal: testPrincipal('someone'),
      tenant: 'acme',
    });
    const refused = await other.attempt(
      'core.eraseSubject',
      { subjectId: spelled[asked], reason } as never,
      { prefer: 'async' },
    );
    expect(refused.ok).toBe(false);
    await stopBooted();
  };

  const openThread = (operator: Operator, owner: string) =>
    operator.invoke('probe.open', { ownerId: owner as never, title: 't' });
  const linkRow = (operator: Operator, owner: string) =>
    (operator as { invoke: (action: string, input: unknown) => Promise<unknown> }).invoke(
      'linked.link',
      { owner, note: 'a note' },
    );

  for (const order of [
    ['compact', 'hyphenated'],
    ['hyphenated', 'compact'],
  ] as const) {
    test(
      `a row that holds the subject as ${order[0]} is owned by a request spelled ${order[1]} (one field)`,
      {
        timeout: 60_000,
      },
      () => acceptsOwnErasure(undefined, openThread, order),
    );

    test(
      `a row that holds the subject as ${order[0]} is owned by a request spelled ${order[1]} (path through a reference)`,
      {
        timeout: 60_000,
      },
      () => acceptsOwnErasure(erasureLinkedApp, linkRow, order),
    );
  }
});

describe('the subject and the reason are checked before anything is stored (14.7.5)', () => {
  test('a subject that is no subject UUID is a validation error and no job, receipt or log line holds it', {
    timeout: 120_000,
  }, async () => {
    const lines: LoggedLine[] = [];
    const { runtime, operator, subject } = await bootErasureRules('pglite', {
      logger: recordingLogger(lines),
    });
    const text = 'jan.peeters@example.test';
    const answers: string[] = [];
    for (const subjectId of [
      text,
      'ada',
      '',
      '0192F3A0-0000-7000-8000-0000000000A1',
      '0f1f2f3f4f5f6f7f8f9fafbfcfdfefff0',
      '0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
      '0F1F2F3F4F5F6F7F8F9FAFBFCFDFEFFF',
    ]) {
      const outcome = await operator.attempt('core.eraseSubject', { subjectId, reason } as never, {
        prefer: 'async',
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toMatchObject({ kind: 'validation' });
        answers.push(JSON.stringify(outcome.error));
      }
    }
    await runtime.drainJobs();
    expect(answers.join('\n')).not.toContain(text);
    // No log line of the whole run holds the value.
    expect(JSON.stringify(lines)).not.toContain(text);
    expect(await ledgerOf(runtime)).toEqual([]);
    expect(await writtenIn(runtime)).toEqual({ receipts: 0 });
    // No job at all in the namespace, pending or in the history: the refused inputs never reached the queue.
    const jobTables = async () => {
      const sections = [...sectionsOf(await dumpDatabase(pgliteQuery(runtime.adapter)))].filter(
        ([name]) => name.endsWith('.kw_jobs') || name.endsWith('.kw_job_history'),
      );
      expect(sections.length).toBe(2);
      return sections.map(([, rows]) => rows.trim()).join('');
    };
    expect(await jobTables()).toBe('');
    // The control: the same dump does show the job of an accepted erasure.
    await operator.invoke('core.eraseSubject', { subjectId: subject, reason } as never, {
      prefer: 'async',
    });
    await runtime.drainJobs();
    expect(await jobTables()).not.toBe('');
  });

  test('the reserved decoy subject of a scope is a validation error in either spelling, and nothing is written', {
    timeout: 120_000,
  }, async () => {
    const { runtime, operator } = await bootErasureRules('pglite');
    // The subject of the decoy data key (core keys/decoy-subject.ts): a shredded decoy key would
    // make the lookup of an absent API key cheaper than a found one for good.
    const decoy = '00000000-0000-4000-8000-00000000decc';
    for (const subjectId of [decoy, decoy.replaceAll('-', '')]) {
      const outcome = await operator.attempt('core.eraseSubject', { subjectId, reason } as never, {
        prefer: 'async',
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'validation' });
    }
    await runtime.drainJobs();
    expect(await ledgerOf(runtime)).toEqual([]);
    expect(await writtenIn(runtime)).toEqual({ receipts: 0 });
  });
});
