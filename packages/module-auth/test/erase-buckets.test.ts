import { createHmac } from 'node:crypto';
import type { ErasureRecord, ErasureStep } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { findPlaintext, testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { addressBucket } from '../src/lib/address-bucket.ts';
import {
  ada,
  asBearer,
  codeOf,
  enrol,
  grace,
  type Session,
  signIn,
  subjectOf,
} from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';

const attempts = 5;
const addressAttempts = 10;
const window = 15 * 60;

describe.each(['memory', 'pglite'] as const)(
  'erasure and the auth buckets on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 120_000 : 30_000;

    interface Booted {
      readonly auth: BootedAuth;
      readonly hook: { at?: (step: ErasureStep, record: ErasureRecord) => Promise<void> };
      readonly erase: (subject: string) => Promise<void>;
      readonly used: (module: string, bucket: string, capacity?: number) => Promise<boolean>;
      readonly dump: () => Promise<string>;
    }

    async function boot(): Promise<Booted> {
      const hook: Booted['hook'] = {};
      const worker = erasure({
        pollMs: 3_600_000,
        afterStep: (step, record) => hook.at?.(step, record) ?? Promise.resolve(),
      });
      const auth = await bootAuth(kind, {}, undefined, undefined, undefined, [worker]);
      onTestFinished(() => auth.runtime.stop());
      const tenantId = auth.runtime.tenants.acme?.id;
      if (tenantId === undefined) throw new Error('the app has no tenant acme');
      const scope = { level: 'tenant', backendId: auth.runtime.backendId, tenantId } as const;
      const nameOf = async (module: string, bucket: string): Promise<string> => {
        const key = await auth.runtime.keys.derive(scope, 'keelwerk/bucket/1', 32);
        return createHmac('sha256', key).update(`${module}\u0000${bucket}`).digest('hex');
      };
      return {
        auth,
        hook,
        erase: async (subject) => {
          const sent = await auth.client(testOperator()).attempt(
            'core.eraseSubject',
            { subjectId: subject, reason: 'subjectRequest' } as never,
            {
              prefer: 'async',
            } as never,
          );
          if (!sent.ok) throw sent.error;
          await auth.runtime.drainJobs();
          await worker.pass();
          await auth.runtime.drainJobs();
        },
        // A bucket that was charged holds fewer tokens than its capacity, and the hand clock does not refill it.
        used: async (module, bucket, capacity = attempts) => {
          const name = await nameOf(module, bucket);
          const taken = await auth.inUnit((unit) =>
            unit.buckets.check(name, capacity, { capacity, refillPerSecond: capacity / window }),
          );
          return !taken.ok;
        },
        dump: () => dumpOf(auth),
      };
    }

    const wrong = { password: 'a password that is wrong' };

    /** One failed login with the address and one failed re-authentication in the person's session. */
    async function failures(auth: BootedAuth, who: typeof ada, session: Session): Promise<void> {
      expect(
        codeOf(await auth.request('auth.login', { identifier: who.identifier, ...wrong })),
      ).toBe('auth.invalid_credentials');
      expect(
        codeOf(
          await auth.request('auth.reauthenticate', wrong, {
            headers: asBearer(session.sessionToken),
          }),
        ),
      ).toBe('auth.invalid_credentials');
    }

    async function twoPeople(app: Booted) {
      await enrol(app.auth, ada);
      await enrol(app.auth, grace);
      const sessions = { ada: await signIn(app.auth, ada), grace: await signIn(app.auth, grace) };
      const subjects = {
        ada: await subjectOf(app.auth, sessions.ada),
        grace: await subjectOf(app.auth, sessions.grace),
      };
      await failures(app.auth, ada, sessions.ada);
      await failures(app.auth, grace, sessions.grace);
      return { sessions, subjects };
    }

    test('after a person is erased no bucket of auth is named by their subject or their address, and another person keeps theirs', {
      timeout,
    }, async () => {
      const app = await boot();
      const { subjects } = await twoPeople(app);
      for (const [who, subject] of [
        [ada, subjects.ada],
        [grace, subjects.grace],
      ] as const) {
        expect(await app.used('auth', `identifier:${who.identifier}`)).toBe(true);
        expect(await app.used('auth', `subject:${subject}`)).toBe(true);
      }

      await app.erase(subjects.ada);

      expect(await app.used('auth', `identifier:${ada.identifier}`)).toBe(false);
      expect(await app.used('auth', `subject:${subjects.ada}`)).toBe(false);
      expect(await app.used('auth', `identifier:${grace.identifier}`)).toBe(true);
      expect(await app.used('auth', `subject:${subjects.grace}`)).toBe(true);
    });

    test('an address that failed attempts have locked is open again after the person is erased', {
      timeout,
    }, async () => {
      const app = await boot();
      await enrol(app.auth, ada);
      const session = await signIn(app.auth, ada);
      const subject = await subjectOf(app.auth, session);
      const guess = async () =>
        codeOf(await app.auth.request('auth.login', { identifier: ada.identifier, ...wrong }));
      for (let failed = 0; failed < attempts; failed += 1) {
        expect(await guess()).toBe('auth.invalid_credentials');
      }
      expect(await guess()).toBe('core.rate_limited');

      await app.erase(subject);

      expect(await guess()).toBe('auth.invalid_credentials');
    });

    test('the lock on an address that another person holds now stays when the person who gave it up is erased', {
      timeout,
    }, async () => {
      const app = await boot();
      const credentialId = await enrol(app.auth, ada);
      const session = await signIn(app.auth, ada);
      const subject = await subjectOf(app.auth, session);
      const revoked = await app.auth.request(
        'auth.credential.revoke',
        { id: credentialId },
        { headers: asBearer(session.sessionToken) },
      );
      expect(revoked.ok).toBe(true);
      // Another person signs up with the identifier ada gave up, and failed attempts lock it.
      await enrol(app.auth, { ...ada, password: 'bea has her own long password' });
      const guess = async () =>
        codeOf(await app.auth.request('auth.login', { identifier: ada.identifier, ...wrong }));
      for (let failed = 0; failed < attempts; failed += 1) {
        expect(await guess()).toBe('auth.invalid_credentials');
      }
      expect(await guess()).toBe('core.rate_limited');

      await app.erase(subject);

      expect(await guess()).toBe('core.rate_limited');
    });

    test('a bucket that the subject names after the shred and before the purge is forgotten by the purge', {
      timeout,
    }, async () => {
      const app = await boot();
      const { sessions, subjects } = await twoPeople(app);
      let made = false;
      let code: string | undefined;
      app.hook.at = async (step, record) => {
        // The record names the subject in its canonical form; auth wrote it as 32 hex digits.
        if (step !== 'tombstones' || record.subjectId.replaceAll('-', '') !== subjects.ada) return;
        code = codeOf(
          await app.auth.request('auth.reauthenticate', wrong, {
            headers: asBearer(sessions.ada.sessionToken),
          }),
        );
        made = await app.used('auth', `subject:${subjects.ada}`);
      };
      await app.erase(subjects.ada);
      // The attempt came after the shred, so the reach step could not have forgotten what it made.
      expect(code).toBe('auth.invalid_credentials');
      expect(made).toBe(true);
      expect(await app.used('auth', `subject:${subjects.ada}`)).toBe(false);
    });

    describe('what makes a bucket that names the person after the erasure', () => {
      const address = '203.0.113.7';

      async function erased() {
        const app = await boot();
        const { sessions, subjects } = await twoPeople(app);
        // A failed login from a known remote address: the address bucket is the client's, not the person's.
        await app.auth.request('auth.login', { identifier: ada.identifier, ...wrong }, { address });
        await app.erase(subjects.ada);
        return { app, sessions, subjects };
      }

      test('somebody who types the erased address at a login makes a new bucket by that address, which holds a keyed digest and no readable address', {
        timeout,
      }, async () => {
        const { app } = await erased();
        expect(await app.used('auth', `identifier:${ada.identifier}`)).toBe(false);
        const typed = await app.auth.request('auth.login', {
          identifier: ada.identifier,
          ...wrong,
        });
        expect(codeOf(typed)).toBe('auth.invalid_credentials');
        expect(await app.used('auth', `identifier:${ada.identifier}`)).toBe(true);
        if (kind === 'pglite') {
          expect(findPlaintext(await app.dump(), [ada.identifier, 'ada@'])).toEqual([]);
        }
      });

      test('a failed login with the address between the step and the shred makes a bucket that stays after the erasure', {
        timeout,
      }, async () => {
        const app = await boot();
        const { subjects } = await twoPeople(app);
        let typed: string | undefined;
        app.hook.at = async (step) => {
          if (step !== 'reach' || typed !== undefined) return;
          typed = codeOf(
            await app.auth.request('auth.login', { identifier: ada.identifier, ...wrong }),
          );
        };
        await app.erase(subjects.ada);
        expect(typed).toBe('auth.invalid_credentials');
        // The step had forgotten the bucket of the address before the attempt made a new one.
        expect(await app.used('auth', `identifier:${ada.identifier}`)).toBe(true);
        expect(await app.used('auth', `subject:${subjects.ada}`)).toBe(false);
      });

      test("the erased person's own session does not resolve, so it makes no bucket by the subject", {
        timeout,
      }, async () => {
        const { app, sessions, subjects } = await erased();
        const tried = await app.auth.request('auth.reauthenticate', wrong, {
          headers: asBearer(sessions.ada.sessionToken),
        });
        expect(codeOf(tried)).toBe('core.unauthenticated');
        expect(await app.used('auth', `subject:${subjects.ada}`)).toBe(false);
      });

      test("the bucket of a remote address is the client's and stays", { timeout }, async () => {
        const { app } = await erased();
        expect(await app.used('auth', `address:${addressBucket(address)}`, addressAttempts)).toBe(
          true,
        );
      });
    });
  },
);

/** Every table of the data store as text: PGlite only. */
async function dumpOf(auth: BootedAuth): Promise<string> {
  const { dumpDatabase } = await import('@keelwerk/testing');
  const owner = auth.runtime.adapter as unknown as {
    asOwner<T>(
      fn: (database: {
        query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
      }) => Promise<T>,
    ): Promise<T>;
  };
  return owner.asOwner((database) => dumpDatabase(async (sql) => (await database.query(sql)).rows));
}
