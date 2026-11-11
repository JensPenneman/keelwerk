import type { StreamAppend } from '@keelwerk/core';
import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';

const { tenantA, tenantB, backend } = conformanceScopes;

/** The streams that belong to no entity (S-124): the kernel names their tenancy on the append. */
export function processStreamCases(subject: ConformanceSubject): void {
  describe('event store, streams of no entity (S-124)', () => {
    test('a stream with no entity commits when the append names its tenancy, only in a unit of that scope', async () => {
      const probe = (over: Partial<StreamAppend> = {}) => appendOf(1, [1], over, 'probe.flow');
      await subject.run(tenantA, (unit) => unit.events.append([probe({ tenancy: 'tenant' })]));
      const stream = { type: 'probe.flow', id: conformanceId(1) };
      const read = await subject.read(tenantA, (unit) => unit.events.readStream(stream));
      expect(read.map((e) => e.version)).toEqual([1]);
      expect(
        await failureOf(
          subject.run(backend, (unit) => unit.events.append([probe({ tenancy: 'tenant' })])),
        ),
      ).toEqual({ kind: 'forbidden', code: 'core.forbidden' });
      // Without the tenancy the store looks for an entity of that type, and there is none.
      expect(
        await failureOf(subject.run(tenantB, (unit) => unit.events.append([probe()]))),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
    });
  });
}
