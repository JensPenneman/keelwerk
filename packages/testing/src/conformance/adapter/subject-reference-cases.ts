import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';

const { tenantA } = conformanceScopes;

/** The text of a conformance subject in each of its four spellings: hyphenated, compact, and both upper case. */
function spellingsOf(hyphenated: string): readonly string[] {
  const compact = hyphenated.replaceAll('-', '');
  return [hyphenated, compact, hyphenated.toUpperCase(), compact.toUpperCase()];
}

/** The subject references and keys of a key store (14.7.4): one subject is one entry whatever its spelling or case. */
export function subjectReferenceCases(subject: ConformanceSubject): void {
  describe('subject references (14.7.4)', () => {
    test('the two spellings of one subject share its references: a stream is listed once', async () => {
      const hyphenated = conformanceId(7002);
      const compact = hyphenated.replaceAll('-', '');
      const first = { type: 'conf.owner', id: conformanceId(8101) };
      const second = { type: 'conf.owner', id: conformanceId(8102) };
      await subject.run(tenantA, (unit) => unit.keys.addRefs(hyphenated, [first]));
      await subject.run(tenantA, (unit) => unit.keys.addRefs(compact, [first, second]));
      for (const spelling of [hyphenated, compact]) {
        expect(await subject.read(tenantA, (unit) => unit.keys.refs(spelling, null, 10))).toEqual([
          first,
          second,
        ]);
      }
    });

    test('the four spellings share one key, one reference listing and one shred', async () => {
      const spellings = spellingsOf(conformanceId(7003));
      const stream = { type: 'conf.owner', id: conformanceId(8103) };
      const created = await subject.run(tenantA, (unit) =>
        unit.keys.dataKey(spellings[2] ?? '', { create: true }),
      );
      expect(created).toBeDefined();
      for (const spelling of spellings) {
        const found = await subject.run(tenantA, (unit) =>
          unit.keys.dataKey(spelling, { create: true }),
        );
        expect(found?.id).toBe(created?.id);
      }
      await subject.run(tenantA, (unit) => unit.keys.addRefs(spellings[3] ?? '', [stream]));
      for (const spelling of spellings) {
        expect(await subject.read(tenantA, (unit) => unit.keys.refs(spelling, null, 10))).toEqual([
          stream,
        ]);
      }
      const shredded = await subject.run(tenantA, (unit) => unit.keys.shred(spellings[1] ?? ''));
      expect(shredded.keyIds).toEqual([created?.id]);
      for (const spelling of spellings) {
        expect(
          (await subject.read(tenantA, (unit) => unit.keys.shreddedKeys(spelling))).map(
            (key) => key.keyId,
          ),
        ).toEqual([created?.id]);
      }
      for (const spelling of spellings) {
        expect(
          await subject.run(tenantA, (unit) => unit.keys.dataKey(spelling, { create: true })),
        ).toBeUndefined();
      }
    });
  });
}
