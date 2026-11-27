import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, bootReach, type Person, type ReachStorage } from './support/boot-reach.ts';

/** Another person who signs up with the address that ada gave up. */
const bea: Person = { identifier: ada.identifier, password: 'bea has her own long password' };

describe.each(['memory', 'pglite'] as const)(
  'an address that a living person holds is not the erased person on %s',
  (kind: ReachStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    test('accounts and members: the profile of the erased person is archived, another person registers the address and is invited, and her invitation stays', {
      timeout,
    }, async () => {
      const app = await bootReach(kind, 'accounts');
      onTestFinished(() => app.runtime.stop());
      await app.signUp(ada);
      const subject = await app.subjectOf(ada.identifier);
      await app.archiveProfile(subject);
      await app.signUp(bea);
      expect(await app.subjectOf(bea.identifier)).not.toBe(subject);
      const toBea = await app.invite(bea.identifier);
      await app.erase(subject);
      await app.settle();
      expect(await app.completed(subject)).toBe(true);
      expect(await app.keyLive(subject)).toBe(false);
      expect(await app.invitations()).toEqual([
        expect.objectContaining({ id: toBea.id, status: 'pending', email: bea.identifier }),
      ]);
      expect(await app.keyLive(toBea.id)).toBe(true);
    });

    test('all three modules: her credential is revoked and her profile archived, another person signs up with the address and is invited, and her invitation stays', {
      timeout,
    }, async () => {
      const app = await bootReach(kind);
      onTestFinished(() => app.runtime.stop());
      await app.signUp(ada);
      const subject = await app.subjectOf(ada.identifier);
      await app.revokeCredential(ada);
      await app.archiveProfile(subject);
      await app.signUp(bea);
      expect(await app.subjectOf(bea.identifier)).not.toBe(subject);
      const toBea = await app.invite(bea.identifier);
      await app.erase(subject);
      await app.settle();
      expect(await app.completed(subject)).toBe(true);
      expect(await app.invitations()).toEqual([
        expect.objectContaining({ id: toBea.id, status: 'pending', email: bea.identifier }),
      ]);
      expect(await app.keyLive(toBea.id)).toBe(true);
    });
  },
);
