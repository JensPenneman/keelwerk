import { describe, expect, onTestFinished, test } from 'vitest';
import { type BootedMembers, bootMembers, type MembersStorage } from './support/boot-members.ts';
import {
  acceptAs,
  admin,
  bringUpOwner,
  founder,
  inviteAs,
  invitee,
  joinAs,
  refusalOfAttempt,
  stranger,
} from './support/member-calls.ts';

const invalid = 'members.invitation_invalid';

describe.each(['memory', 'pglite'] as const)(
  'one owner per tenant on %s',
  (kind: MembersStorage) => {
    async function bare(): Promise<BootedMembers> {
      const app = await bootMembers(kind);
      onTestFinished(() => app.runtime.stop());
      return app;
    }

    test('T1: two createOwner calls at once leave one live owner invitation, and two accepts at once one owner', async () => {
      const app = await bare();
      const calls = await Promise.all(
        ['first@example.com', 'second@example.com'].map((email) =>
          app.operator().attempt('members.invitation.createOwner', { email }),
        ),
      );
      for (const call of calls) expect(call.ok).toBe(true);
      const pending = (await app.invitations()).filter((row) => row.status === 'pending');
      expect(pending).toHaveLength(1);
      const tokens = calls.flatMap((call) =>
        call.ok ? [call.value as { id: string; token?: string }] : [],
      );
      const live = tokens.find((issued) => issued.id === pending[0]?.id);
      expect(live?.token).toBeDefined();
      const [one, other] = await Promise.all([
        acceptAs(app, founder, live?.token ?? ''),
        acceptAs(app, stranger, live?.token ?? ''),
      ]);
      expect([one.ok, other.ok].filter(Boolean)).toHaveLength(1);
      expect(refusalOfAttempt(one.ok ? other : one)?.code).toBe(invalid);
      expect(await app.ownerCount()).toBe(1);
    });

    test('T2: the store refuses a second owner row, whatever wrote it', async () => {
      const app = await bare();
      await bringUpOwner(app);
      const adminId = await joinAs(app, admin, 'admin', 'admin@example.com');
      await expect(app.plant('membership', adminId, { role: 'owner' })).rejects.toThrow();
      expect(await app.ownerCount()).toBe(1);
      expect((await app.row('membership', adminId))?.role).toBe('admin');
    });

    test('T2b: an invitation turned into an owner one in a tenant that has an owner is refused as a conflict, and no second owner exists', async () => {
      const app = await bare();
      await bringUpOwner(app);
      const invited = await inviteAs(app, founder, { email: 'late@example.com', role: 'member' });
      await app.plant('invitation', invited.id, { role: 'owner' });
      const accepted = await acceptAs(app, invitee, invited.token ?? '');
      expect(refusalOfAttempt(accepted)).toMatchObject({ kind: 'conflict', code: 'core.conflict' });
      expect(await app.ownerCount()).toBe(1);
    });

    test('T3: once the owner is erased, the tenant is brought up again and has one owner', async () => {
      const app = await bare();
      await bringUpOwner(app);
      await joinAs(app, admin, 'admin', 'admin@example.com');
      // The owner's person is erased: the owner membership is archived and releases the slot.
      await app.operator().invoke(
        'core.eraseSubject',
        {
          subjectId: (await app.as(admin).invoke('members.membership.query', {})).items.find(
            (row) => row.role === 'owner',
          )?.subject,
          reason: 'subjectRequest',
        } as never,
        { prefer: 'async' } as never,
      );
      await app.settle();
      expect(await app.ownerCount()).toBe(0);
      const again = await app
        .operator()
        .invoke('members.invitation.createOwner', { email: 'new.owner@example.com' });
      expect((await acceptAs(app, invitee, again.token ?? '')).ok).toBe(true);
      expect(await app.ownerCount()).toBe(1);
      // Invitations still work for the new owner.
      const invited = await inviteAs(app, invitee, { email: 'ada@example.com', role: 'member' });
      expect((await app.row('invitation', invited.id))?.status).toBe('pending');
    });
  },
);
