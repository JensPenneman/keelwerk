import { describe, expect, test } from 'vitest';
import {
  backendId,
  retain,
  retainedTenantScope,
  retentionScopeOf,
  tenantUuid,
} from './support/retain-scope-fake.ts';

describe('the run of one scope', () => {
  test('a pass that removed nothing and failed nowhere records no run', async () => {
    expect(await retain(retentionScopeOf(retainedTenantScope, 'ns-a').scope)).toBeUndefined();
  });

  test('every buffer that drained has its horizon, every buffer that ran its rule and its count', async () => {
    const { scope } = retentionScopeOf(retainedTenantScope, 'ns-a', {
      transient: [3],
      jobs: [1],
      expire: [2],
    });
    const run = await retain(scope);
    expect(run).toMatchObject({
      outcome: 'complete',
      error: null,
      namespaceId: 'ns-a',
      backendId,
      tenantId: tenantUuid,
      removed: {
        transientRecords: 3,
        receipts: 0,
        valueKeys: 0,
        jobHistory: 1,
        streamTickets: 0,
        streamRecords: { 'shelf.log': 2 },
      },
      horizons: {
        transientRecords: '2026-11-11T12:00:00.000Z',
        receipts: '2026-11-18T12:00:00.000Z',
        jobHistory: '2026-11-11T12:00:00.000Z',
        streamTickets: '2026-11-17T12:00:00.000Z',
      },
    });
    expect(run?.rule.rules.map((rule) => rule.kind)).toEqual([
      'receipts',
      'transientRecords',
      'jobHistory',
      'streamTickets',
      'streamRecords',
    ]);
    expect(run?.rule).not.toHaveProperty('adoptedBy');
  });

  test('a buffer drains with a short batch and not before: full batches repeat', async () => {
    const full = retentionScopeOf(retainedTenantScope, 'ns-a', { transient: [10, 10, 7] });
    const run = await retain(full.scope);
    expect(full.calls.filter((call) => call === 'transient')).toHaveLength(3);
    expect(run?.removed.transientRecords).toBe(27);
    expect(run?.horizons.transientRecords).toBe('2026-11-11T12:00:00.000Z');
  });

  test('a short batch that says candidates are left repeats, and the buffer drains on the batch that says none are', async () => {
    const run = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-a', {
        transient: [
          { removed: 4, more: true },
          { removed: 3, more: false },
        ],
      }).scope,
    );
    expect(run?.removed.transientRecords).toBe(7);
    expect(run?.horizons.transientRecords).toBe('2026-11-11T12:00:00.000Z');
  });

  test('a batch that removed nothing while candidates are left leaves the buffer without a horizon', async () => {
    // Another pass holds the rest: the batch was short, and a short batch is no proof.
    const held = [
      { removed: 5, more: true },
      { removed: 0, more: true },
    ];
    const records = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-a', { transient: held }).scope,
    );
    expect(records?.removed.transientRecords).toBe(5);
    expect(records?.horizons).not.toHaveProperty('transientRecords');
    expect(records?.horizons).toHaveProperty('jobHistory');
    const history = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-a', { jobs: held }).scope,
    );
    expect(history?.removed.jobHistory).toBe(5);
    expect(history?.horizons).not.toHaveProperty('jobHistory');
    expect(history?.horizons).toHaveProperty('transientRecords');
  });

  test('a receipt step whose locking read found nothing while an expired receipt is left has no horizon', async () => {
    const run = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-a', { transient: [1], receiptsLeft: true }).scope,
    );
    expect(run?.removed.receipts).toBe(0);
    expect(run?.horizons).not.toHaveProperty('receipts');
    expect(run?.horizons).toHaveProperty('jobHistory');
  });

  test('a buffer whose full page could not be purged is not drained and has no horizon', async () => {
    const run = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-a', { transient: [1], receiptsStuck: true }).scope,
      2,
    );
    expect(run?.outcome).toBe('complete');
    expect(run?.removed.receipts).toBe(0);
    expect(run?.horizons).not.toHaveProperty('receipts');
    // The buffers after it still ran and drained.
    expect(run?.horizons).toHaveProperty('jobHistory');
    expect(run?.rule.rules.map((rule) => rule.kind)).toContain('receipts');
  });

  test('the same scope served by two namespaces gives two runs that tell them apart', async () => {
    const first = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-first', { transient: [1] }).scope,
    );
    const second = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-second', { transient: [1] }).scope,
    );
    expect([first?.namespaceId, second?.namespaceId]).toEqual(['ns-first', 'ns-second']);
    expect([first?.backendId, first?.tenantId]).toEqual([second?.backendId, second?.tenantId]);
  });

  test('the deployment scope has no ticket buffer and keeps no stream of a tenant', async () => {
    const deployment = retentionScopeOf({ level: 'deployment' }, 'ns-control', { transient: [1] });
    const run = await retain(deployment.scope);
    expect(run?.backendId).toBe('deployment-1');
    expect(run?.tenantId).toBeNull();
    expect(run?.rule.rules.map((rule) => rule.kind)).toEqual([
      'receipts',
      'transientRecords',
      'jobHistory',
    ]);
    expect(Object.keys(run?.removed ?? {})).toEqual([
      'receipts',
      'valueKeys',
      'transientRecords',
      'jobHistory',
    ]);
    expect(Object.keys(run?.horizons ?? {})).toEqual([
      'receipts',
      'transientRecords',
      'jobHistory',
    ]);
    expect(deployment.calls).not.toContain('expire');
  });

  test('a stream of another tenancy is not listed, applied or counted', async () => {
    const backendScope = retentionScopeOf(
      { level: 'backend', backendId },
      'ns-a',
      { transient: [1] },
      'tenant',
    );
    const run = await retain(backendScope.scope);
    expect(run?.rule.rules.some((rule) => rule.kind === 'streamRecords')).toBe(false);
    expect(run?.removed).not.toHaveProperty('streamRecords');
    expect(backendScope.calls).not.toContain('expire');
    const own = retentionScopeOf(
      { level: 'backend', backendId },
      'ns-a',
      { transient: [1], expire: [1] },
      'backend',
    );
    const owned = await retain(own.scope);
    expect(owned?.rule.rules.some((rule) => rule.kind === 'streamRecords')).toBe(true);
    expect(owned?.removed.streamRecords).toEqual({ 'shelf.log': 1 });
  });
});
