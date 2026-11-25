import { afterEach, describe, expect, test } from 'vitest';
import {
  afterOwnershipRead,
  boot,
  current,
  erasures,
  providers,
  putOff,
  resetOwnErasure,
  targeting,
} from './support/own-erasure-kit.ts';
import { erasureHold, legalHold } from './support/own-erasure-module.ts';
import { setFlag } from './support/targeting-kit.ts';

afterEach(resetOwnErasure);

describe.each(['memory', 'pglite'] as const)(
  'a module erases the id of its own row on %s',
  (adapter) => {
    test('C6: a hold on the erasure does not stop the end; the erasure starts when the hold lifts', async () => {
      const { operator, rows, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      erasureHold.on = true;
      const ended = await operator.attempt('oes.end', { itemId });
      expect(ended.ok).toBe(true);
      expect((await rows('oes.item', true))[0]?.state).toBe('ended');
      await settle();
      expect(erasures(await ledger())).toEqual([]);
      expect(await keyLive(itemId)).toBe(true);
      // Still held when the job asks again; a hold in force is no warning.
      await current?.advanceTo(current.clock.now().add({ hours: 2 }));
      await settle();
      expect(erasures(await ledger())).toEqual([]);
      expect(putOff).toEqual([]);
      erasureHold.on = false;
      await current?.advanceTo(current.clock.now().add({ hours: 2 }));
      await settle();
      expect(erasures(await ledger())).toHaveLength(1);
      expect(await keyLive(itemId)).toBe(false);
      expect(await rows('oes.item', true)).toEqual([]);
    });

    test.each(providers)(
      'C6b: a hold that reads a flag a provider turns on keeps the key until the provider turns it off (%s provider)',
      async (_label, provider) => {
        const { operator, ledger, settle, keyLive } = await boot(adapter, provider);
        const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
        legalHold.on = true;
        expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
        await settle();
        // The job asks again twice, and the flag holds each time: the key is not shredded.
        for (let retry = 0; retry < 2; retry += 1) {
          await current?.advanceTo(current.clock.now().add({ hours: 2 }));
          await settle();
          expect(erasures(await ledger())).toEqual([]);
          expect(await keyLive(itemId)).toBe(true);
        }
        legalHold.on = false;
        await current?.advanceTo(current.clock.now().add({ hours: 2 }));
        await settle();
        expect(erasures(await ledger())).toHaveLength(1);
        expect(await keyLive(itemId)).toBe(false);
      },
    );

    test.each(providers)(
      "C6c: the operator's own erasure call is refused while the flag holds and succeeds after (%s provider)",
      async (_label, provider) => {
        const { operator, ledger, settle, keyLive } = await boot(adapter, provider);
        const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
        legalHold.on = true;
        const refused = await operator.attempt('core.eraseSubject', {
          subjectId: itemId,
          reason: 'subjectRequest',
        });
        expect(refused.ok).toBe(false);
        expect(refused.error?.kind).toBe('forbidden');
        await settle();
        expect(erasures(await ledger())).toEqual([]);
        expect(await keyLive(itemId)).toBe(true);
        legalHold.on = false;
        const allowed = await operator.attempt('core.eraseSubject', {
          subjectId: itemId,
          reason: 'subjectRequest',
        });
        expect(allowed.ok).toBe(true);
        await settle();
        expect(await keyLive(itemId)).toBe(false);
      },
    );

    // On PGlite the cache does not wait for a load that is still in flight (`fresh`), so the rows may
    // serve STALE at the admission: the erasure then waits instead of finding no hold.
    test('C6d: a hold turned on by a targeting row keeps the key when the job asks again long after the row was loaded', async () => {
      const { runtime, operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      expect((await setFlag(runtime, targeting(true))).ok).toBe(true);
      expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
      await settle();
      expect(await keyLive(itemId)).toBe(true);
      // No call of an invocation refreshes the rows meanwhile: only the job's own admission can.
      for (let retry = 0; retry < 2; retry += 1) {
        await current?.advanceTo(current.clock.now().add({ hours: 2 }));
        await settle();
        expect(erasures(await ledger())).toEqual([]);
        expect(await keyLive(itemId)).toBe(true);
      }
    });

    test('C6e: a hold turned on by a targeting row keeps the key while the rows cannot be loaded again', async () => {
      const { runtime, operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      expect((await setFlag(runtime, targeting(true))).ok).toBe(true);
      expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
      await settle();
      // The read of the flag rows fails (the only deployment read that carries a time limit): no reload
      // reaches the cache, whose rows grow stale.
      const store = runtime.control.adapter;
      const unit = store.unit.bind(store);
      store.unit = ((namespace, scope, work, options) =>
        scope.level === 'deployment' && options?.timeoutMs !== undefined
          ? Promise.reject(new Error('the store is down'))
          : unit(namespace, scope, work, options)) as typeof store.unit;
      try {
        for (let retry = 0; retry < 2; retry += 1) {
          await current?.advanceTo(current.clock.now().add({ hours: 2 }));
          await settle();
          expect(await keyLive(itemId)).toBe(true);
        }
      } finally {
        store.unit = unit as typeof store.unit;
      }
      expect(erasures(await ledger())).toEqual([]);
    });

    // On PGlite the feed's own poll starts a load at every step of the clock, and a job that falls due
    // in the same step finds it in flight and waits, so the end of this case is shown on memory only.
    test.runIf(adapter === 'memory')(
      'C6g: on memory, a hold turned off by a targeting row lets the erasure start once the rows load again',
      async () => {
        const { runtime, operator, ledger, settle, keyLive } = await boot(adapter);
        const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
        expect((await setFlag(runtime, targeting(true))).ok).toBe(true);
        expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
        await settle();
        expect(await keyLive(itemId)).toBe(true);
        expect((await setFlag(runtime, targeting(false))).ok).toBe(true);
        await current?.advanceTo(current.clock.now().add({ hours: 2 }));
        await settle();
        expect(erasures(await ledger())).toHaveLength(1);
        expect(await keyLive(itemId)).toBe(false);
      },
    );

    test.each(providers)(
      'C6f: a hold whose flag a provider cannot answer keeps the key until it can (%s provider)',
      async (_label, provider) => {
        const { operator, ledger, settle, keyLive } = await boot(adapter, provider);
        const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
        legalHold.on = true;
        legalHold.failing = true;
        expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
        await settle();
        for (let retry = 0; retry < 2; retry += 1) {
          await current?.advanceTo(current.clock.now().add({ hours: 2 }));
          await settle();
          expect(erasures(await ledger())).toEqual([]);
          expect(await keyLive(itemId)).toBe(true);
        }
        expect(putOff.length).toBeGreaterThanOrEqual(2);
        expect(putOff.every((warning) => warning.kind === 'flag')).toBe(true);
        legalHold.failing = false;
        legalHold.on = false;
        await current?.advanceTo(current.clock.now().add({ hours: 2 }));
        await settle();
        expect(erasures(await ledger())).toHaveLength(1);
        expect(await keyLive(itemId)).toBe(false);
      },
    );

    test('C6h: a hold rule that fails delays the erasure, which runs once the rule works and nothing holds it', async () => {
      const { operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      erasureHold.failing = true;
      expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
      await settle();
      for (let retry = 0; retry < 2; retry += 1) {
        await current?.advanceTo(current.clock.now().add({ hours: 2 }));
        await settle();
        expect(erasures(await ledger())).toEqual([]);
        expect(await keyLive(itemId)).toBe(true);
      }
      // Each attempt that the failing rule put off is a warning with the command id and the kind, and
      // nothing that names the subject.
      expect(putOff.length).toBeGreaterThanOrEqual(2);
      for (const warning of putOff) {
        expect(Object.keys(warning).sort()).toEqual(['commandId', 'kind']);
        expect(warning.kind).toBe('rule');
        expect(JSON.stringify(warning)).not.toContain(itemId);
      }
      erasureHold.failing = false;
      await current?.advanceTo(current.clock.now().add({ hours: 2 }));
      await settle();
      expect(erasures(await ledger())).toHaveLength(1);
      expect(await keyLive(itemId)).toBe(false);
    });

    test('C6i: a hold is tried without an end: after more than a year under it, the erasure runs once it is lifted', async () => {
      const { operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      erasureHold.on = true;
      expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
      await settle();
      for (let month = 0; month < 14; month += 1) {
        await current?.advanceTo(current.clock.now().add({ hours: 30 * 24 }));
        await settle();
      }
      expect(erasures(await ledger())).toEqual([]);
      expect(await keyLive(itemId)).toBe(true);
      erasureHold.on = false;
      await current?.advanceTo(current.clock.now().add({ hours: 30 * 24 }));
      await settle();
      expect(erasures(await ledger())).toHaveLength(1);
      expect(await keyLive(itemId)).toBe(false);
    });

    test('C6j: a hold that comes in after the ownership was read and before the record holds the erasure', async () => {
      const { runtime, operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      // The hold comes in as the ownership read ends, between it and the flag snapshot.
      const restore = afterOwnershipRead(runtime.adapter, () => {
        legalHold.on = true;
      });
      try {
        expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
        await settle();
        expect(erasures(await ledger())).toEqual([]);
        expect(await keyLive(itemId)).toBe(true);
      } finally {
        restore();
      }
    });

    test('C6k: an ownership read that fails once delays the erasure, which runs when the read works', async () => {
      const { runtime, operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      let failures = 1;
      const restore = afterOwnershipRead(runtime.adapter, () => {
        if (failures-- > 0) throw new Error('the read fails');
      });
      try {
        expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
        await settle();
        // The failed read is seen by its warning. Whether the retry has run by now depends on the gap
        // it drew at random, so nothing is asserted about the ledger yet: the later record is the proof.
        expect(putOff).toEqual([{ commandId: expect.any(String), kind: 'ownership' }]);
        await current?.advanceTo(current.clock.now().add({ hours: 2 }));
        await settle();
        expect(erasures(await ledger())).toHaveLength(1);
        expect(await keyLive(itemId)).toBe(false);
        expect(putOff).toHaveLength(1);
      } finally {
        restore();
      }
    });
  },
);
