import type { ApiUsageCount } from '@keelwerk/core';
import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';

const { tenantA, backend, deployment } = conformanceScopes;

function count(over: Partial<ApiUsageCount>): ApiUsageCount {
  return {
    day: '2026-11-10',
    backendId: conformanceId(1),
    tenantId: conformanceId(2),
    apiVersion: '2026-11-04',
    transport: 'rest',
    item: '',
    count: 1,
    ...over,
  };
}

/**
 * The cases of the API usage store (S-144, 18.5): one list for every subject, run by the memory
 * conformance suite and by the PGlite and PostgreSQL control-root tests. The two cases that touch no
 * table (a read-only unit refuses `add`, only deployment-scope units carry the store) run everywhere.
 *
 * `table` says whether the subject's unit reaches the `kw_api_usage` table. The table lives in the
 * control root only, and `describeAdapterConformance` runs a SQL adapter in the namespace of an app,
 * which has no such table: there the cases that read or write it skip. A subject on the control root
 * (PGlite in data/test/pglite-api-usage.test.ts, PostgreSQL in
 * adapter-postgres/test/api-usage.postgres.test.ts) passes `true` and runs the same cases.
 */
export function apiUsageCases(
  subject: Pick<ConformanceSubject, 'run' | 'read'>,
  options: { readonly table: boolean },
): void {
  describe('api usage (S-144, 18.5)', () => {
    const tableCase = (name: string, body: () => Promise<void>): void => {
      test(name, async (context) => {
        if (!options.table) context.skip();
        await body();
      });
    };
    tableCase('add inserts a row and adds to it on the next add', async () => {
      await subject.run(deployment, async (unit) => unit.apiUsage?.add([count({ count: 3 })]));
      await subject.run(deployment, async (unit) =>
        unit.apiUsage?.add([count({ count: 4 }), count({ transport: 'graphql' })]),
      );
      const totals = await subject.read(deployment, async (unit) =>
        unit.apiUsage?.totals({ since: '2026-11-10', until: '2026-11-10', limit: 10 }),
      );
      expect(totals?.map((total) => [total.transport, total.count])).toEqual([
        ['graphql', 1],
        ['rest', 7],
      ]);
    });

    tableCase(
      'totals sum over days and group by backend, tenant, version, transport, item in order',
      async () => {
        await subject.run(deployment, async (unit) =>
          unit.apiUsage?.add([
            count({ day: '2026-11-10', count: 2 }),
            count({ day: '2026-11-12', count: 5 }),
            count({ day: '2026-11-11', item: 'library.book.list', count: 1 }),
            count({ day: '2026-11-11', backendId: conformanceId(0), count: 9 }),
          ]),
        );
        const totals = await subject.read(deployment, async (unit) =>
          unit.apiUsage?.totals({ since: '2026-11-01', until: '2026-11-30', limit: 10 }),
        );
        expect(totals).toEqual([
          {
            backendId: conformanceId(0),
            tenantId: conformanceId(2),
            apiVersion: '2026-11-04',
            transport: 'rest',
            item: '',
            count: 9,
            firstDay: '2026-11-11',
            lastDay: '2026-11-11',
          },
          {
            backendId: conformanceId(1),
            tenantId: conformanceId(2),
            apiVersion: '2026-11-04',
            transport: 'rest',
            item: '',
            count: 7,
            firstDay: '2026-11-10',
            lastDay: '2026-11-12',
          },
          {
            backendId: conformanceId(1),
            tenantId: conformanceId(2),
            apiVersion: '2026-11-04',
            transport: 'rest',
            item: 'library.book.list',
            count: 1,
            firstDay: '2026-11-11',
            lastDay: '2026-11-11',
          },
        ]);
      },
    );

    tableCase('totals filter by days, backend, version and item and stop at limit', async () => {
      await subject.run(deployment, async (unit) =>
        unit.apiUsage?.add([
          count({ day: '2026-11-10', count: 2 }),
          count({ day: '2026-11-12', count: 5 }),
          count({ apiVersion: '2026-11-11', count: 1 }),
          count({ item: 'library.book.list', count: 1 }),
          count({ backendId: conformanceId(0), count: 1 }),
        ]),
      );
      const totals = (query: { [key: string]: string | number }) =>
        subject.read(deployment, async (unit) =>
          unit.apiUsage?.totals({ since: '2026-11-10', until: '2026-11-10', limit: 10, ...query }),
        );
      expect((await totals({}))?.length).toBe(4);
      expect((await totals({ until: '2026-11-12' }))?.[1]?.count).toBe(7);
      expect((await totals({ since: '2026-11-11', until: '2026-11-11' }))?.length).toBe(0);
      expect((await totals({ backendId: conformanceId(0) }))?.length).toBe(1);
      expect((await totals({ apiVersion: '2026-11-11' }))?.map((row) => row.count)).toEqual([1]);
      expect((await totals({ item: 'library.book.list' }))?.length).toBe(1);
      expect((await totals({ limit: 2 }))?.length).toBe(2);
    });

    test('add is refused in a read-only unit', async () => {
      expect(
        await failureOf(
          subject.read(deployment, async (unit) => unit.apiUsage?.add([count({})]) ?? undefined),
        ),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
    });

    test('only deployment-scope units carry the store', async () => {
      expect(await subject.run(deployment, async (unit) => unit.apiUsage !== undefined)).toBe(true);
      for (const scope of [tenantA, backend]) {
        expect(await subject.run(scope, async (unit) => unit.apiUsage === undefined)).toBe(true);
      }
    });
  });
}
