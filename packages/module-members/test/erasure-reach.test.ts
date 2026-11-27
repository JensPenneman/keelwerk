import type { ErasureStep } from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  ada,
  type BootedReach,
  bootReach,
  grace,
  type ReachStorage,
} from './support/boot-reach.ts';

describe.each(['memory', 'pglite'] as const)(
  'erasure reaches invitations on %s',
  (kind: ReachStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(): Promise<BootedReach> {
      const app = await bootReach(kind);
      onTestFinished(() => app.runtime.stop());
      return app;
    }

    /** The erasure records of the control ledger that name this subject. */
    async function recordsOf(app: BootedReach, subjectId: string): Promise<number> {
      return (await app.erasures()).filter((record) => record.subjectId === subjectId).length;
    }

    test('erasing a person erases the pending invitation to their address, in their tenant only', {
      timeout,
    }, async () => {
      const app = await boot();
      await app.signUp(ada);
      const subject = await app.subjectOf(ada.identifier);
      const toAda = await app.invite(ada.identifier);
      const toGrace = await app.invite(grace.identifier);
      // The same address in another tenant, where the person never signed up.
      const elsewhere = await app.invite(ada.identifier, 'globex');
      expect((await app.invitations()).map((row) => row.id).sort()).toEqual(
        [toAda.id, toGrace.id].sort(),
      );
      expect(await app.keyLive(toAda.id)).toBe(true);

      await app.erase(subject);
      await app.settle();

      expect(await app.invitations()).toEqual([
        expect.objectContaining({ id: toGrace.id, status: 'pending', email: grace.identifier }),
      ]);
      expect(await app.keyLive(toAda.id)).toBe(false);
      expect(await app.accepts(toAda.token)).toBe(false);
      expect(await app.keyLive(toGrace.id)).toBe(true);
      // The invitation of the same address in the other tenant is untouched.
      expect(await app.invitations('globex')).toEqual([
        expect.objectContaining({ id: elsewhere.id, status: 'pending', email: ada.identifier }),
      ]);
      expect(await app.keyLive(elsewhere.id, 'globex')).toBe(true);
      expect(await recordsOf(app, toAda.id)).toBe(1);
      expect(await recordsOf(app, toGrace.id)).toBe(0);
      expect(await recordsOf(app, elsewhere.id)).toBe(0);
    });

    test('the step runs between the ledger record and the shred, and the seams name it', {
      timeout,
    }, async () => {
      const app = await boot();
      await app.signUp(ada);
      const subject = await app.subjectOf(ada.identifier);
      await app.invite(ada.identifier);
      const after: ErasureStep[] = [];
      const inside: ErasureStep[] = [];
      app.seams.afterStep = async (step, record) => {
        if (record.subjectId === subject) after.push(step);
      };
      app.seams.insideStep = async (step, record) => {
        if (record.subjectId === subject) inside.push(step);
      };
      await app.erase(subject);
      await app.settle();
      expect(after.slice(0, 3)).toEqual(['ledger', 'reach', 'shred']);
      expect(inside).toContain('reach');
    });

    test.each(['auth', 'accounts'] as const)(
      'with only %s, the address it holds is found',
      {
        timeout,
      },
      async (variant) => {
        const app = await bootReach(kind, variant);
        onTestFinished(() => app.runtime.stop());
        await app.signUp(ada);
        const subject = await app.subjectOf(ada.identifier);
        const toAda = await app.invite(ada.identifier);
        const toGrace = await app.invite(grace.identifier);
        await app.erase(subject);
        await app.settle();
        expect((await app.invitations()).map((row) => row.id)).toEqual([toGrace.id]);
        expect(await app.keyLive(toAda.id)).toBe(false);
      },
    );

    test("the invitation has its own erasure, which runs after the person's: until then it is still there", {
      timeout,
    }, async () => {
      const app = await boot();
      await app.signUp(ada);
      const subject = await app.subjectOf(ada.identifier);
      const toAda = await app.invite(ada.identifier);
      await app.erase(subject);
      await app.drain();
      await app.pass();
      expect(await app.completed(subject)).toBe(true);
      // The pass that completed the person's erasure had read its records before the request was
      // written, so the invitation's own erasure has not run: its steps are the next pass's.
      expect((await app.invitations()).map((row) => row.id)).toEqual([toAda.id]);
      await app.settle();
      expect(await app.invitations()).toEqual([]);
    });

    test('another spelling of the address is found', { timeout }, async () => {
      const app = await boot();
      await app.signUp(ada);
      const subject = await app.subjectOf(ada.identifier);
      const spelled = await app.invite('ADA@Example.ORG');
      await app.erase(subject);
      await app.settle();
      expect(await app.invitations()).toEqual([]);
      expect(await app.keyLive(spelled.id)).toBe(false);
    });

    test('an invitation issued to the address after the erasure is a new invitation and stays', {
      timeout,
    }, async () => {
      const app = await boot();
      await app.signUp(ada);
      await app.erase(await app.subjectOf(ada.identifier));
      await app.settle();
      const later = await app.invite(ada.identifier);
      await app.settle();
      expect(await app.invitations()).toEqual([
        expect.objectContaining({ id: later.id, status: 'pending', email: ada.identifier }),
      ]);
    });

    test("an address that another person holds now is not the erased person's: her invitation stays", {
      timeout,
    }, async () => {
      const app = await bootReach(kind, 'auth');
      onTestFinished(() => app.runtime.stop());
      await app.signUp(ada);
      const subject = await app.subjectOf(ada.identifier);
      await app.revokeCredential(ada);
      // Another person signs up with the address ada gave up, and is invited to it.
      const bea = { identifier: ada.identifier, password: 'bea has her own long password' };
      await app.signUp(bea);
      const toBea = await app.invite(bea.identifier);
      await app.erase(subject);
      await app.settle();
      // The credential keeps the subject as 32 hex digits, the ledger names it canonically: the key tells.
      expect(await app.keyLive(subject)).toBe(false);
      expect(await app.invitations()).toEqual([
        expect.objectContaining({ id: toBea.id, status: 'pending', email: bea.identifier }),
      ]);
      expect(await app.keyLive(toBea.id)).toBe(true);
      expect(await recordsOf(app, toBea.id)).toBe(0);
    });

    test('the address of an archived profile is found', { timeout }, async () => {
      const app = await bootReach(kind, 'accounts');
      onTestFinished(() => app.runtime.stop());
      await app.signUp(ada);
      const subject = await app.subjectOf(ada.identifier);
      const toAda = await app.invite(ada.identifier);
      await app.archiveProfile(subject);
      await app.erase(subject);
      await app.settle();
      expect(await app.completed(subject)).toBe(true);
      expect(await app.invitations()).toEqual([]);
      expect(await app.keyLive(toAda.id)).toBe(false);
    });

    describe.each([
      ['before the step', 'afterStep', 'ledger'],
      ['inside the step', 'insideStep', 'reach'],
      ['after the step', 'afterStep', 'reach'],
      ['after the shred', 'afterStep', 'shred'],
    ] as const)('a crash %s', (_name, seam, step: ErasureStep) => {
      test('is repaired by the next pass: each invitation is requested once', {
        timeout,
      }, async () => {
        const app = await boot();
        await app.signUp(ada);
        const subject = await app.subjectOf(ada.identifier);
        const toAda = await app.invite(ada.identifier);
        let crashed = false;
        app.seams[seam] = async (at, record) => {
          if (at !== step || record.subjectId !== subject || crashed) return;
          crashed = true;
          throw new Error(`crash ${seam} ${step}`);
        };
        await app.erase(subject);
        await app.drain();
        await app.pass();
        expect(crashed).toBe(true);
        await app.pass();
        expect(await app.completed(subject)).toBe(true);
        await app.settle();
        expect(await app.invitations()).toEqual([]);
        expect(await app.keyLive(toAda.id)).toBe(false);
        expect(await recordsOf(app, toAda.id)).toBe(1);
        expect(await recordsOf(app, subject)).toBe(1);
      });
    });
  },
);
