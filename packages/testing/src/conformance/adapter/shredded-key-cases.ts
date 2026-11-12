import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';

const { tenantA } = conformanceScopes;

/** `shreddedKeys` of the subject key store (14.7.5): the keys a shred destroyed, now or before. */
export function shreddedKeyCases(subject: ConformanceSubject): void {
  describe('shredded keys (14.7.5)', () => {
    test('shreddedKeys answers nothing before a shred, then every destroyed key with its instant, also after a second shred', async () => {
      const subjectId = conformanceId(7004);
      const shreddedOf = () => subject.run(tenantA, (unit) => unit.keys.shreddedKeys(subjectId));
      expect(await shreddedOf()).toEqual([]);
      const created = await subject.run(tenantA, (unit) =>
        unit.keys.dataKey(subjectId, { create: true }),
      );
      expect(await shreddedOf()).toEqual([]);
      await subject.run(tenantA, (unit) => unit.keys.shred(subjectId));
      const first = await shreddedOf();
      expect(first.map((key) => key.keyId)).toEqual([created?.id]);
      expect(first[0]?.shreddedAt).toBeInstanceOf(Temporal.Instant);
      // A second shred destroys nothing and the same keys are answered with the same instants.
      const second = await subject.run(tenantA, (unit) => unit.keys.shred(subjectId));
      expect(second.keyIds).toEqual([]);
      expect(await shreddedOf()).toEqual(first);
      // It is a read: a read-only unit answers it too.
      expect(await subject.read(tenantA, (unit) => unit.keys.shreddedKeys(subjectId))).toEqual(
        first,
      );
    });
  });
}
