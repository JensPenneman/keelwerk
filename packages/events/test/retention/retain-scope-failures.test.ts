import { errors, transientPurgeTypes } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { RetentionHalted } from '../../src/retention/retention-halted.ts';
import {
  failing,
  retain,
  retainedTenantScope,
  retainFully,
  retentionScopeOf,
} from './support/retain-scope-fake.ts';

describe('a buffer or a stream that fails', () => {
  test('a scope that fails before it removed anything records a failed run with kind and code only', async () => {
    const run = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-a', { failTransientAt: 0 }).scope,
    );
    expect(run).toMatchObject({
      outcome: 'failed',
      error: { kind: 'internal', code: 'core.internal' },
      removed: { transientRecords: 0 },
    });
    expect(run?.rule.rules.map((rule) => rule.kind)).toEqual([
      'receipts',
      'transientRecords',
      'jobHistory',
      'streamTickets',
      'streamRecords',
    ]);
    expect(run?.horizons).not.toHaveProperty('transientRecords');
    expect(JSON.stringify(run?.error)).not.toContain('stored message');
  });

  test('a scope that fails after removing something keeps its counts and gives no horizon to the buffer that failed', async () => {
    const run = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-a', { transient: [10, 10], failTransientAt: 2 })
        .scope,
    );
    expect(run?.outcome).toBe('failed');
    expect(run?.removed).toEqual({
      receipts: 0,
      valueKeys: 0,
      transientRecords: 20,
      jobHistory: 0,
      streamTickets: 0,
      streamRecords: { 'shelf.log': 0 },
    });
    expect(Object.keys(run?.horizons ?? {})).toEqual(['receipts', 'jobHistory', 'streamTickets']);
  });

  test('retention purges the stream types of transientPurgeTypes and no other', async () => {
    const store = retentionScopeOf(retainedTenantScope, 'ns-a', { transient: [1] });
    await retain(store.scope);
    expect(store.purgedTypes).toEqual([transientPurgeTypes]);
  });

  test('a transient buffer that throws ends only that buffer: the others are counted, drained and have horizons', async () => {
    const store = retentionScopeOf(retainedTenantScope, 'ns-a', { jobs: [2], expire: [3] });
    const result = await retainFully(
      store.scope,
      10,
      failing('transientRecords', () => new Error('a stored message')),
    );
    const run = result.run;
    expect(run?.outcome).toBe('failed');
    expect(run?.error).toEqual({ kind: 'internal', code: 'core.internal' });
    expect(run?.rule.rules.map((rule) => rule.kind)).toEqual([
      'receipts',
      'transientRecords',
      'jobHistory',
      'streamTickets',
      'streamRecords',
    ]);
    expect(run?.removed).toMatchObject({
      receipts: 0,
      transientRecords: 0,
      jobHistory: 2,
      streamTickets: 0,
      streamRecords: { 'shelf.log': 3 },
    });
    expect(Object.keys(run?.horizons ?? {})).toEqual(['receipts', 'jobHistory', 'streamTickets']);
    expect(result.failures.map((failure) => failure.buffer)).toEqual(['transientRecords']);
    expect(store.calls).not.toContain('transient');
  });

  test('the first unit of a scope is the receipts unit and the run lists receipts first', async () => {
    const opened: string[] = [];
    const run = await retain(
      retentionScopeOf(retainedTenantScope, 'ns-a', { transient: [1] }).scope,
      10,
      async (_s, buffer) => {
        opened.push(buffer);
      },
    );
    expect(opened[0]).toBe('receipts');
    expect(run?.rule.rules[0]?.kind).toBe('receipts');
    expect(opened.slice(0, 4)).toEqual([
      'receipts',
      'transientRecords',
      'jobHistory',
      'streamTickets',
    ]);
  });

  test('two buffers that fail give the error of the first and both failures', async () => {
    const result = await retainFully(
      retentionScopeOf(retainedTenantScope, 'ns-a', { transient: [1] }).scope,
      10,
      async (_scope, buffer) => {
        if (buffer === 'receipts') throw errors.validation('the receipts fail');
        if (buffer === 'jobHistory') throw new Error('the job history fails');
      },
    );
    expect(result.run?.outcome).toBe('failed');
    expect(result.run?.error).toEqual({ kind: 'validation', code: 'core.validation' });
    expect(result.failures.map((failure) => failure.buffer)).toEqual(['receipts', 'jobHistory']);
    expect(result.failures.every((failure) => failure.stream === undefined)).toBe(true);
    expect(Object.keys(result.run?.horizons ?? {})).toEqual(['transientRecords', 'streamTickets']);
  });

  test('a halt after an earlier buffer failed records no run and throws', async () => {
    await expect(
      retainFully(
        retentionScopeOf(retainedTenantScope, 'ns-a').scope,
        10,
        async (_scope, buffer) => {
          if (buffer === 'receipts') throw new Error('the receipts fail');
          if (buffer === 'transientRecords') throw new RetentionHalted();
        },
      ),
    ).rejects.toBeInstanceOf(RetentionHalted);
  });

  test('a declared stream that fails ends only itself: the next stream is counted', async () => {
    const store = retentionScopeOf(retainedTenantScope, 'ns-a', {
      expire: [4],
      secondStream: true,
      failStream: 'shelf.log',
    });
    const result = await retainFully(store.scope);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ buffer: 'streamRecords', stream: 'shelf.log' });
    expect(result.run?.outcome).toBe('failed');
    expect(result.run?.removed.streamRecords).toEqual({ 'shelf.log': 0, 'shelf.audit': 4 });
    expect(result.run?.rule.rules.filter((rule) => rule.kind === 'streamRecords')).toHaveLength(2);
  });
});
