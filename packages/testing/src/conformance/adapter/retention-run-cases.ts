import type { RetentionRun } from '@keelwerk/core';
import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { stamp } from './stamp.ts';

const { tenantA, backend, deployment } = conformanceScopes;

function run(number: number, over: Partial<RetentionRun> = {}): RetentionRun {
  return {
    runId: conformanceId(7000 + number),
    startedAt: stamp.add({ minutes: number }),
    endedAt: stamp.add({ minutes: number, seconds: 2 }),
    namespaceId: 'conformance-app',
    backendId: conformanceId(1),
    tenantId: conformanceId(2),
    outcome: 'complete',
    error: null,
    rule: {
      rules: [
        { kind: 'transientRecords', olderThan: 'P7D' },
        { kind: 'receipts', olderThan: null },
        { kind: 'jobHistory', olderThan: 'P7D' },
        { kind: 'streamTickets', olderThan: 'P1D' },
        { kind: 'streamRecords', stream: 'library.book', maxAge: 'P1D', maxPerKey: 5 },
      ],
    },
    removed: {
      transientRecords: 4,
      receipts: 2,
      valueKeys: 1,
      jobHistory: 3,
      streamTickets: 0,
      streamRecords: { 'library.book': 6 },
    },
    horizons: {
      transientRecords: '2025-12-25T00:00:00.000Z',
      receipts: '2026-01-01T00:00:00.000Z',
      jobHistory: '2025-12-25T00:00:00.000Z',
      streamTickets: '2025-12-31T00:00:00.000Z',
    },
    ...over,
  };
}

/** A run with its instants as text, which `toEqual` compares (a Temporal instant has no own members). */
function plain(value: RetentionRun): unknown {
  return { ...value, startedAt: value.startedAt.toString(), endedAt: value.endedAt.toString() };
}

/**
 * The retention run store (14.7.1, S-172): one list for every subject, run by the memory
 * conformance suite and by the PGlite and PostgreSQL control-root tests. The cases that touch no
 * table (a read-only unit refuses `append`, only deployment-scope units carry the store) run
 * everywhere.
 *
 * `table` says whether the subject's unit reaches the `kw_retention_runs` table, which lives in the
 * control root only (see `apiUsageCases`). `ownerInsert`, for a subject on a real database, inserts
 * a row as the owner role with no namespace, no outcome and no error, which only a row of 0.1.0
 * could be: it must read back with null in those members.
 */
export function retentionRunCases(
  subject: Pick<ConformanceSubject, 'run' | 'read' | 'deploymentId'>,
  options: {
    readonly table: boolean;
    readonly ownerInsert?: (row: {
      readonly runId: string;
      readonly backendId: string;
      readonly tenantId: string;
    }) => Promise<void>;
  },
): void {
  describe('retention runs (14.7.1, S-172)', () => {
    const tableCase = (name: string, body: () => Promise<void>): void => {
      test(name, async (context) => {
        if (!options.table) context.skip();
        await body();
      });
    };
    const append = (value: RetentionRun) =>
      subject.run(deployment, async (unit) => unit.retentionRuns?.append(value));
    const list = (backendId: string, tenantId: string | null, limit = 10) =>
      subject.read(
        deployment,
        async (unit) => (await unit.retentionRuns?.list({ backendId, tenantId, limit })) ?? [],
      );

    tableCase('an appended run lists back as written', async () => {
      const written = run(1);
      await append(written);
      const listed = await list(conformanceId(1), conformanceId(2));
      expect(listed.map(plain)).toEqual([plain(written)]);
    });

    tableCase(
      'a failed run lists back with its error, its applied rules and the horizons that drained',
      async () => {
        const failed = run(2, {
          outcome: 'failed',
          error: { kind: 'unavailable', code: 'core.lock_timeout' },
          rule: { rules: [{ kind: 'transientRecords', olderThan: 'P7D' }] },
          removed: { transientRecords: 0 },
          horizons: {},
        });
        await append(failed);
        const listed = await list(conformanceId(1), conformanceId(2));
        expect(listed.map(plain)).toEqual([plain(failed)]);
        expect(listed[0]?.removed).not.toHaveProperty('receipts');
        expect(listed[0]?.horizons).toEqual({});
      },
    );

    test('a row with no namespace, no outcome and no error reads back with null, never with the text null or a failure', async (context) => {
      const { ownerInsert } = options;
      if (!options.table || ownerInsert === undefined) context.skip();
      await ownerInsert?.({
        runId: conformanceId(7100),
        backendId: conformanceId(1),
        tenantId: conformanceId(2),
      });
      const [row] = await list(conformanceId(1), conformanceId(2));
      expect(row?.runId).toBe(conformanceId(7100));
      expect(row?.namespaceId).toBeNull();
      expect(row?.outcome).toBeNull();
      expect(row?.error).toBeNull();
    });

    tableCase(
      'an outcome that this version does not write reads back as stored, not as a failure',
      async () => {
        await append(run(3, { outcome: 'partial' }));
        const [row] = await list(conformanceId(1), conformanceId(2));
        expect(row?.outcome).toBe('partial');
      },
    );

    tableCase(
      'one scope served by two namespaces gives two rows that tell them apart',
      async () => {
        await append(run(1, { namespaceId: 'first-app' }));
        await append(run(2, { namespaceId: 'second-app' }));
        const listed = await list(conformanceId(1), conformanceId(2));
        expect(listed.map((row) => row.namespaceId)).toEqual(['second-app', 'first-app']);
      },
    );

    tableCase(
      'list is per scope, newest first, deployment runs under backendId = deployment id and tenantId null',
      async () => {
        const deploymentId = subject.deploymentId ?? conformanceId(9);
        const first = run(1, { backendId: deploymentId, tenantId: null });
        const second = run(2, { backendId: deploymentId, tenantId: null });
        const tenant = run(3);
        for (const value of [first, second, tenant]) await append(value);
        expect((await list(deploymentId, null)).map(plain)).toEqual([plain(second), plain(first)]);
        expect((await list(deploymentId, null, 1)).map(plain)).toEqual([plain(second)]);
        expect((await list(conformanceId(1), conformanceId(2))).map(plain)).toEqual([
          plain(tenant),
        ]);
        expect(await list(conformanceId(1), null)).toEqual([]);
      },
    );

    tableCase('list refuses a limit outside 1 to 1000', async () => {
      for (const limit of [0, 1001]) {
        expect(await failureOf(list(conformanceId(1), null, limit))).toEqual({
          kind: 'validation',
          code: 'core.malformed_request',
        });
      }
    });

    test('a read-only unit refuses append', async () => {
      expect(
        await failureOf(
          subject.read(deployment, async (unit) => unit.retentionRuns?.append(run(1))),
        ),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
    });

    test('only deployment-scope units carry the store', async () => {
      expect(await subject.run(deployment, async (unit) => unit.retentionRuns !== undefined)).toBe(
        true,
      );
      for (const scope of [tenantA, backend]) {
        expect(await subject.run(scope, async (unit) => unit.retentionRuns === undefined)).toBe(
          true,
        );
      }
    });
  });
}
