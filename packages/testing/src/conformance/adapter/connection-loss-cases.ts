import { conformanceEntities, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { rowAt } from './row-at.ts';

const { owner } = conformanceEntities;
const { tenantA } = conformanceScopes;

/**
 * A store that reaches its data over a connection answers `core.unavailable` when the connection
 * ends under an open unit (14.3.6): the start of a process waits on that code, and a caller retries
 * it. A store without connections has nothing to end.
 */
export function connectionLossCases(subject: ConformanceSubject): void {
  describe('a connection ended by the server (14.3.6)', () => {
    test.runIf(subject.networked)(
      'a unit whose connection ended fails with core.unavailable and the next unit commits',
      async () => {
        const failure = await failureOf(
          subject.run(tenantA, async (unit) => {
            await unit.rows.insert(owner, [rowAt(1, { name: 'lost' })]);
            await subject.endConnections();
            await unit.rows.count(owner);
          }),
        );
        expect(failure).toEqual({ kind: 'unavailable', code: 'core.unavailable' });
        await subject.run(tenantA, (unit) => unit.rows.insert(owner, [rowAt(2, { name: 'kept' })]));
        const names = await subject.read(tenantA, async (unit) =>
          (await unit.rows.find(owner, { sort: [{ field: 'id', direction: 'asc' }] })).rows.map(
            (row) => row.name,
          ),
        );
        expect(names).toEqual(['kept']);
      },
    );
  });
}
