import { clientAddresses } from '@keelwerk/testing';
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

    test('all three modules: the lock that failed logins put on her address stays when the erased person is erased', {
      timeout,
    }, async () => {
      const app = await bootReach(kind);
      onTestFinished(() => app.runtime.stop());
      await app.signUp(ada);
      const subject = await app.subjectOf(ada.identifier);
      await app.revokeCredential(ada);
      await app.archiveProfile(subject);
      await app.signUp(bea);
      const addresses = clientAddresses();
      const guess = async () => {
        const reply = (await app.runtime.invoker.invoke({
          action: 'auth.login',
          input: { identifier: bea.identifier, password: 'a password that is wrong' },
          carrier: {
            transport: 'test',
            headers: { 'x-tenant': app.runtime.tenants.acme.id },
            connection: {
              id: 'guess',
              listener: 'http',
              remote: { address: addresses(), port: 40000 },
              local: { address: '127.0.0.1', port: 8080 },
            },
          },
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        } as never)) as unknown as { error?: { code?: string } };
        return reply.error?.code;
      };
      for (let failed = 0; failed < 5; failed += 1) {
        expect(await guess()).toBe('auth.invalid_credentials');
      }
      expect(await guess()).toBe('core.rate_limited');
      await app.erase(subject);
      await app.settle();
      expect(await app.completed(subject)).toBe(true);
      expect(await guess()).toBe('core.rate_limited');
    });
  },
);
