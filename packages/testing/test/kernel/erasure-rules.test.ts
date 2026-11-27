import type { StoredEvent } from '@keelwerk/core';
import { flagScrubCommandId } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { dumpDatabase } from '../../src/index.ts';
import { pgliteQuery, sectionsOf } from './support/dump-sections.ts';
import {
  bootErasureRules,
  ledgerOf,
  operatorCarrier,
  rulesMarkerEmail,
  stopBooted,
} from './support/erasure-rules-kit.ts';

afterEach(stopBooted);

describe('who may erase (14.7.5)', () => {
  test('a user is refused unless a rule lets them erase their own subject', async () => {
    const { user, subject } = await bootErasureRules();
    const outcome = await user.attempt(
      'core.eraseSubject',
      { subjectId: subject, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'forbidden' });
  });

  test('an operator outside an entered tenant is refused', async () => {
    const { runtime, subject } = await bootErasureRules();
    const outcome = await runtime.invoker.invoke({
      action: 'core.eraseSubject',
      input: { subjectId: subject, reason: 'subjectRequest' },
      carrier: operatorCarrier,
      requestId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      prefer: 'async',
      signal: new AbortController().signal,
    });
    expect(outcome.ok).toBe(false);
    expect(await ledgerOf(runtime)).toEqual([]);
  });

  test('a reason outside the closed list is refused as validation and writes no ledger record', async () => {
    const { runtime, operator, subject } = await bootErasureRules();
    for (const reason of [
      'not a token',
      'nul\u0000byte',
      '',
      'user_request',
      'jan.peeters@example.test',
      'gdpr-art17-0471234567',
    ]) {
      const outcome = await operator.attempt(
        'core.eraseSubject',
        { subjectId: subject, reason } as never,
        { prefer: 'async' },
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'validation' });
    }
    expect(await ledgerOf(runtime)).toEqual([]);
  });

  test('a subject of another tenant fails not_found and writes no ledger record', async () => {
    const { runtime, worker, subject } = await bootErasureRules();
    const globex = createLocalClient(runtime, { principal: testOperator(), tenant: 'globex' });
    const accepted = await globex.invoke(
      'core.eraseSubject',
      { subjectId: subject, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    await worker.pass();
    const commandId = String((accepted as { commandId: string }).commandId);
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.globex.id,
    } as const;
    const receipt = await runtime.sealed.unit(runtime.namespace, scope, (unit) =>
      unit.receipts.get(commandId),
    );
    expect(receipt?.status).toBe('failed');
    expect(receipt?.outcome).toMatchObject({ ok: false, error: { code: 'core.not_found' } });
    expect(await ledgerOf(runtime)).toEqual([]);
    // acme still holds the person.
    const acme = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const descriptor = runtime.app.registry.entities.get('probe.person')?.descriptor;
    if (descriptor === undefined) throw new Error('no probe.person');
    const rows = await runtime.sealed.unit(
      runtime.namespace,
      acme,
      async (unit) => (await unit.rows.find(descriptor, {})).rows,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('what the erasure command leaves behind', () => {
  test('its receipt holds no personal value and its events carry the erasure command id', async () => {
    const { runtime, worker, operator, subject } = await bootErasureRules();
    const accepted = await operator.invoke(
      'core.eraseSubject',
      { subjectId: subject, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    const commandId = String((accepted as { commandId: string }).commandId);
    await runtime.drainJobs();
    await worker.pass();
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const { receipt, events } = await runtime.sealed.unit(
      runtime.namespace,
      scope,
      async (unit) => ({
        receipt: await unit.receipts.get(commandId),
        events: (await unit.events.readAll(null, { limit: 100, includeTransient: true })).events,
      }),
    );
    expect(receipt?.status).toBe('completed');
    expect(JSON.stringify(receipt)).not.toContain(rulesMarkerEmail);
    const erased = events.filter((event: StoredEvent) => event.type.endsWith('.erased'));
    expect(erased.map((event) => event.commandId)).toEqual([commandId]);
    // The receipt's change records carry no value either.
    const records = events.filter((event) => event.stream.type === 'core.commandReceipt');
    expect(JSON.stringify(records.map((event) => event.data))).not.toContain(rulesMarkerEmail);
    const ledger = await ledgerOf(runtime);
    expect(JSON.stringify(ledger.map((entry) => entry.record))).not.toContain(rulesMarkerEmail);
    expect(ledger.map((entry) => entry.record.type)).toEqual([
      'erasure',
      'keyTombstone',
      'erasureCompleted',
    ]);
  });

  test('its job, its history and the flag scrub carry no value, and the scrub has the reserved command id', {
    timeout: 120_000,
  }, async () => {
    const { runtime, worker, operator, subject } = await bootErasureRules('pglite');
    const flag = await runtime.invoker.invoke<unknown, { id: string }>({
      action: 'core.flag.set',
      input: {
        key: 'probe.beta',
        backendId: runtime.backendId,
        targeting: {
          enabled: true,
          rules: [{ id: 'one', principals: [subject], serve: { value: true } }],
          fallthrough: { value: false },
        },
        reason: 'rules',
      },
      carrier: operatorCarrier,
      requestId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    expect(flag.ok).toBe(true);
    const accepted = await operator.invoke(
      'core.eraseSubject',
      { subjectId: subject as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    const commandId = String((accepted as { commandId: string }).commandId);
    await runtime.drainJobs();
    await worker.pass();

    // The job and its history are the closed forms: no value of the subject.
    const dump = await dumpDatabase(pgliteQuery(runtime.adapter));
    const sections = [...sectionsOf(dump)].filter(
      ([name]) => name.endsWith('.kw_jobs') || name.endsWith('.kw_job_history'),
    );
    expect(sections.length).toBe(2);
    expect(sections.map(([, rows]) => rows).join('\n')).not.toContain(rulesMarkerEmail);
    const jobs = sections.find(([name]) => name.endsWith('.kw_jobs'))?.[1] ?? '';
    expect(jobs).not.toContain('core.eraseSubject');
    const history = sections.find(([name]) => name.endsWith('.kw_job_history'))?.[1] ?? '';
    expect(history).toContain('succeeded');

    // The flag scrub is the kernel's own command: its events carry the reserved command id.
    const flagEvents = await runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      async (unit) =>
        (await unit.events.readAll(null, { limit: 500 })).events.filter(
          (event) => event.stream.type === 'core.flag',
        ),
      { readOnly: true },
    );
    const scrubId = flagScrubCommandId({
      tenantId: runtime.tenants.acme.id,
      commandId,
      subjectId: subject,
    });
    const scrub = flagEvents.filter((event) => event.commandId === scrubId);
    expect(scrub.length).toBeGreaterThan(0);
    expect(JSON.stringify(scrub.map((event) => event.data))).not.toContain(subject);
  });

  test('the erasure drops the rule that named only the subject from the targeting and from the one it kept before', {
    timeout: 120_000,
  }, async () => {
    const { runtime, worker, operator, subject } = await bootErasureRules('pglite');
    const setFlag = async (serve: boolean) => {
      const outcome = await runtime.invoker.invoke({
        action: 'core.flag.set',
        input: {
          key: 'probe.beta',
          backendId: runtime.backendId,
          targeting: {
            enabled: true,
            rules: [
              {
                id: 'one',
                tenants: [runtime.tenants.acme.id],
                principals: [subject],
                serve: { value: serve },
              },
            ],
            fallthrough: { value: !serve },
          },
          reason: 'rules',
        },
        carrier: operatorCarrier,
        requestId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
      expect(outcome.ok).toBe(true);
    };
    await setFlag(true);
    await setFlag(false);
    const descriptor = runtime.app.registry.entities.get('core.flag')?.descriptor;
    if (descriptor === undefined) throw new Error('no core.flag');
    const rulesOf = async () => {
      const { rows } = await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.rows.find(descriptor, {}),
        { readOnly: true },
      );
      return rows.map((row) => ({
        targeting: (row.targeting as { rules: unknown[] }).rules,
        previous: (row.previous as { rules: unknown[] } | undefined)?.rules,
      }));
    };
    expect(await rulesOf()).toEqual([
      { targeting: [expect.anything()], previous: [expect.anything()] },
    ]);
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: subject as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    await worker.pass();
    expect(await rulesOf()).toEqual([{ targeting: [], previous: [] }]);
  });
});
