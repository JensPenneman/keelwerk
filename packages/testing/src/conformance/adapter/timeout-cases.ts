import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';

const { tenantA, tenantB } = conformanceScopes;

export function timeoutCases(subject: ConformanceSubject): void {
  describe('timeouts (14.3.6)', () => {
    test('a unit waiting for the namespace gives up after timeoutMs with core.timeout', async (t) => {
      if (subject.capabilities().processes !== 'single') return t.skip();
      let release: () => void = () => undefined;
      let held: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      const first = subject.run(tenantA, async () => {
        held();
        await gate;
      });
      const giveUp: { id?: ReturnType<typeof setTimeout> } = {};
      try {
        await holding;
        // The waiting unit must give up on its own; the bound keeps a hung wait from holding the gate.
        const refused = await Promise.race([
          failureOf(subject.run(tenantB, async () => 1, { timeoutMs: 20 })),
          new Promise<never>((_, reject) => {
            giveUp.id = setTimeout(() => {
              reject(new Error('the waiting unit did not give up after timeoutMs'));
            }, 2000);
          }),
        ]);
        expect(refused).toEqual({ kind: 'unavailable', code: 'core.timeout' });
      } finally {
        clearTimeout(giveUp.id);
        release();
        await first;
      }
    });
  });
}
