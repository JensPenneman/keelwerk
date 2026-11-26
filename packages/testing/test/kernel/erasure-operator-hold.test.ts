import { afterEach, describe, expect, test } from 'vitest';
import { boot, current, erasures, putOff, resetOwnErasure } from './support/own-erasure-kit.ts';
import { legalHold } from './support/own-erasure-module.ts';

afterEach(resetOwnErasure);

const request = (subjectId: string) => ({ subjectId, reason: 'subjectRequest' });
const later = (hours: number) => current?.advanceTo(current.clock.now().add({ hours }));

describe.each(['memory', 'pglite'] as const)(
  "an operator's erasure meets the hold at its job start on %s",
  (adapter) => {
    test('H1: an erasure accepted before a hold waits at its job start and starts when the hold lifts', async () => {
      const { operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      expect((await operator.attempt('core.eraseSubject', request(itemId))).ok).toBe(true);
      legalHold.on = true;
      await settle();
      expect(erasures(await ledger())).toEqual([]);
      expect(await keyLive(itemId)).toBe(true);
      await later(2);
      await settle();
      expect(erasures(await ledger())).toEqual([]);
      expect(putOff).toEqual([]);
      legalHold.on = false;
      await later(2);
      await settle();
      expect(erasures(await ledger())).toHaveLength(1);
      expect(await keyLive(itemId)).toBe(false);
    });

    test('H2: a hold that lasts past 24 hours and past three attempts still lets the erasure start afterwards', async () => {
      const { operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      expect((await operator.attempt('core.eraseSubject', request(itemId))).ok).toBe(true);
      legalHold.on = true;
      for (let day = 0; day < 4; day += 1) {
        await later(24);
        await settle();
      }
      expect(erasures(await ledger())).toEqual([]);
      expect(await keyLive(itemId)).toBe(true);
      legalHold.on = false;
      await later(24);
      await settle();
      expect(erasures(await ledger())).toHaveLength(1);
      expect(await keyLive(itemId)).toBe(false);
    });

    test('H3: a hold that comes in after the record in the ledger does not stop the erasure', async () => {
      const { runtime, operator, worker, ledger, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      expect((await operator.attempt('core.eraseSubject', request(itemId))).ok).toBe(true);
      await runtime.drainJobs();
      expect(erasures(await ledger())).toHaveLength(1);
      legalHold.on = true;
      await worker.pass();
      await runtime.drainJobs();
      expect(await keyLive(itemId)).toBe(false);
    });

    test('H4: a hold flag that cannot be read puts the erasure off with a warning that names no subject', async () => {
      const { operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      expect((await operator.attempt('core.eraseSubject', request(itemId))).ok).toBe(true);
      legalHold.on = true;
      legalHold.failing = true;
      await settle();
      await later(2);
      await settle();
      expect(erasures(await ledger())).toEqual([]);
      expect(await keyLive(itemId)).toBe(true);
      expect(putOff.length).toBeGreaterThanOrEqual(2);
      for (const warning of putOff) {
        expect(Object.keys(warning).sort()).toEqual(['commandId', 'kind']);
        expect(warning.kind).toBe('flag');
        expect(JSON.stringify(warning)).not.toContain(itemId);
      }
      legalHold.failing = false;
      legalHold.on = false;
      await later(2);
      await settle();
      expect(erasures(await ledger())).toHaveLength(1);
      expect(await keyLive(itemId)).toBe(false);
    });
  },
);
