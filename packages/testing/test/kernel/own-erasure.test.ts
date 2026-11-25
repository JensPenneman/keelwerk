import { afterEach, describe, expect, test } from 'vitest';
import { boot, current, erasures, person, resetOwnErasure } from './support/own-erasure-kit.ts';
import { erasureHold } from './support/own-erasure-module.ts';

afterEach(resetOwnErasure);

describe.each(['memory', 'pglite'] as const)(
  'a module erases the id of its own row on %s',
  (adapter) => {
    test('C1: the commit holds the request, the worker erases the row and the ledger names the module', async () => {
      const { operator, settle, rows, ledger } = await boot(adapter);
      const made = await operator.invoke('oes.make', { note: 'a personal note' });
      const itemId = String(made.itemId);
      await operator.invoke('oes.end', { itemId });
      // The request job found its accepted receipt: the ledger records the erasure before any step ran.
      await current?.drainJobs();
      const before = erasures(await ledger());
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({
        subjectId: itemId,
        reason: 'retention',
        requester: { kind: 'service', id: 'oes.system' },
      });
      expect((await rows('oes.item', false))[0]?.kwErasedAt ?? null).toBeNull();
      await settle();
      const [item] = await rows('oes.item', false);
      expect(item?.kwErasedAt).toBeDefined();
      expect(await rows('oes.item', true)).toEqual([]);
    });

    test('C2: a row moved to another subject in the same decision is left alone by the walk', async () => {
      const { operator, settle, rows, ledger } = await boot(adapter);
      const subject = person();
      const keeper = String((await operator.invoke('oes.make', { subject, note: 'kept' })).itemId);
      const moved = String((await operator.invoke('oes.make', { note: 'moves' })).itemId);
      await operator.invoke('oes.end', { itemId: moved, moveTo: subject });
      await settle();
      expect(erasures(await ledger()).map((record) => record.subjectId)).toEqual([moved]);
      const live = await rows('oes.item', true);
      expect(live.map((row) => String(row.id)).sort()).toEqual([keeper, moved].sort());
      expect(live.map((row) => row.note).sort()).toEqual(['kept', 'moves']);
    });

    test('C3: another module cannot ask for the erasure of a row that is not its own, and its writes roll back', async () => {
      const { operator, rows, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      const refused = await operator.attempt('intruder.ask', { type: 'oes.item', id: itemId });
      expect(refused.ok).toBe(false);
      expect(refused.error?.code).toBe('core.request_not_allowed');
      expect(await rows('intruder.trace', false)).toEqual([]);
      expect(await keyLive(itemId)).toBe(true);
    });

    test('C3b: a request for an id that is no live row of the module is refused when it is made', async () => {
      const { operator, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      const missing = crypto.randomUUID();
      const refused = await operator.attempt('oes.request', { itemId: missing });
      expect(refused.ok).toBe(false);
      expect(refused.error?.code).toBe('core.request_not_allowed');
      expect(await keyLive(missing)).toBe(false);
      expect(await keyLive(itemId)).toBe(true);
    });

    test('C4: an id that equals a subject another row owns ends the row, and the key stays', async () => {
      const { operator, rows, keyLive, settle, ledger } = await boot(adapter);
      const victim = person();
      await operator.invoke('oes.hold', { ownerId: victim, label: 'owned by the victim' });
      await operator.invoke('oes.make', { id: victim, note: 'a copy of the id' });
      expect(await keyLive(victim)).toBe(true);
      const ended = await operator.attempt('oes.end', { itemId: victim });
      expect(ended.ok).toBe(true);
      expect((await rows('oes.item', true))[0]?.state).toBe('ended');
      // The job asks again, and every time another row holds the subject: nothing is erased.
      await settle();
      await current?.advanceTo(current.clock.now().add({ hours: 3 }));
      await settle();
      expect(await keyLive(victim)).toBe(true);
      expect(erasures(await ledger())).toEqual([]);
    });

    test('C5: an id that another stream refers to ends the row, and the key stays', async () => {
      const { operator, rows, keyLive, settle, ledger } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      await operator.invoke('oes.speak', {
        ownerId: person(),
        aboutId: itemId,
        text: 'about it',
      });
      const ended = await operator.attempt('oes.end', { itemId });
      expect(ended.ok).toBe(true);
      expect((await rows('oes.item', true))[0]?.state).toBe('ended');
      await settle();
      await current?.advanceTo(current.clock.now().add({ hours: 3 }));
      await settle();
      expect(await keyLive(itemId)).toBe(true);
      expect(erasures(await ledger())).toEqual([]);
    });

    test('C7: a job that first starts more than a day after its request still erases', async () => {
      const { operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      // The workers are held back by the hold until the clock has gone past the default receipt window.
      erasureHold.on = true;
      await operator.invoke('oes.end', { itemId });
      await settle();
      erasureHold.on = false;
      await current?.advanceTo(current.clock.now().add({ hours: 30 }));
      await settle();
      expect(erasures(await ledger())).toHaveLength(1);
      expect(await keyLive(itemId)).toBe(false);
    });
  },
);
