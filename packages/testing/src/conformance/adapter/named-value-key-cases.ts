import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';

const { tenantA, tenantB } = conformanceScopes;
const binding = { entity: 'conf.principal', id: 'principal-1', field: 'request' };
const keyId = 'principal:principal-1';
const text = (value: string) => new TextEncoder().encode(value);

/** Value keys that a caller names (one long-lived key for many values, 14.7.4). */
export function namedValueKeyCases(subject: ConformanceSubject): void {
  describe('a named value key', () => {
    test('is created on first use and seals many values, and one destroy ends them all', async () => {
      const first = await subject.run(tenantA, (unit) =>
        unit.keys.sealValue(binding, text('one'), { keyId }),
      );
      const second = await subject.run(tenantA, (unit) =>
        unit.keys.sealValue(binding, text('two'), { keyId }),
      );
      expect([first.keyId, second.keyId]).toEqual([keyId, keyId]);
      expect(await subject.run(tenantA, (unit) => unit.keys.openValue(first, binding))).toEqual(
        text('one'),
      );
      expect(await subject.run(tenantA, (unit) => unit.keys.openValue(second, binding))).toEqual(
        text('two'),
      );
      expect(
        await subject.run(tenantA, (unit) => unit.keys.liveValueKeys(['other', keyId])),
      ).toEqual([keyId]);
      await subject.run(tenantA, (unit) => unit.keys.destroyValueKey(keyId));
      expect(await subject.run(tenantA, (unit) => unit.keys.openValue(first))).toBeUndefined();
      expect(await subject.run(tenantA, (unit) => unit.keys.openValue(second))).toBeUndefined();
      expect(await subject.run(tenantA, (unit) => unit.keys.liveValueKeys([keyId]))).toEqual([]);
    });

    test('belongs to its scope: another scope has no such key', async () => {
      const sealed = await subject.run(tenantA, (unit) =>
        unit.keys.sealValue(binding, text('mine'), { keyId: 'principal:scoped' }),
      );
      expect(await subject.run(tenantB, (unit) => unit.keys.openValue(sealed))).toBeUndefined();
      expect(
        await subject.run(tenantB, (unit) => unit.keys.liveValueKeys(['principal:scoped'])),
      ).toEqual([]);
      await subject.run(tenantA, (unit) => unit.keys.destroyValueKey('principal:scoped'));
    });
  });
}
