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
  'an inviter who lost their power on %s',
  (kind: MembersStorage) => {
    async function boot(): Promise<BootedMembers> {
      const app = await bootMembers(kind);
      onTestFinished(() => app.runtime.stop());
      await bringUpOwner(app);
      return app;
    }

    test('R1: removing an admin withdraws the invitations they issued, and their token is dead', async () => {
      const app = await boot();
      const adminId = await joinAs(app, admin, 'admin', 'admin@example.com');
      const first = await inviteAs(app, admin, { email: 'x@attacker.example', role: 'admin' });
      const second = await inviteAs(app, admin, { email: 'y@attacker.example', role: 'member' });
      const kept = await inviteAs(app, founder, { email: 'z@example.com', role: 'member' });
      const removed = await app
        .as(founder)
        .attempt('members.membership.removeMember', { id: adminId as never });
      if (!removed.ok) throw removed.error;
      expect((await app.row('invitation', first.id))?.status).toBe('withdrawn');
      expect((await app.row('invitation', second.id))?.status).toBe('withdrawn');
      expect((await app.row('invitation', kept.id))?.status).toBe('pending');
      // The removed person signs in with any account and presents the token.
      for (const token of [first.token, second.token]) {
        expect(refusalOfAttempt(await acceptAs(app, stranger, token ?? ''))?.code).toBe(invalid);
      }
      const members = await app.as(founder).invoke('members.membership.query', {});
      expect(members.items.map((row) => row.role)).toEqual(['owner']);
      // What the removal withdrew ends like any withdrawn invitation: its address and key are gone.
      await app.settle();
      expect(await app.row('invitation', first.id)).toBeUndefined();
      expect((await app.keysOf(first.id)).live).toBe(false);
      expect((await acceptAs(app, invitee, kept.token ?? '')).ok).toBe(true);
    });

    test('R2: demoting an admin withdraws their pending invitations; promoting to admin withdraws none', async () => {
      const app = await boot();
      const adminId = await joinAs(app, admin, 'admin', 'admin@example.com');
      const mine = await inviteAs(app, admin, { email: 'a@example.com', role: 'admin' });
      const same = await app
        .as(founder)
        .attempt('members.membership.changeRole', { id: adminId as never, role: 'admin' });
      if (!same.ok) throw same.error;
      expect((await app.row('invitation', mine.id))?.status).toBe('pending');
      const demoted = await app
        .as(founder)
        .attempt('members.membership.changeRole', { id: adminId as never, role: 'member' });
      if (!demoted.ok) throw demoted.error;
      expect((await app.row('invitation', mine.id))?.status).toBe('withdrawn');
      expect(refusalOfAttempt(await acceptAs(app, invitee, mine.token ?? ''))?.code).toBe(invalid);
      const promoted = await app
        .as(founder)
        .attempt('members.membership.changeRole', { id: adminId as never, role: 'admin' });
      if (!promoted.ok) throw promoted.error;
      // The new power starts with no invitation: the withdrawn one stays withdrawn.
      expect((await app.row('invitation', mine.id))?.status).toBe('withdrawn');
    });

    test('R3: an invitation whose inviter is no admin any more is invalid even when it still reads as pending', async () => {
      const app = await boot();
      const adminId = await joinAs(app, admin, 'admin', 'admin@example.com');
      const mine = await inviteAs(app, admin, { email: 'a@example.com', role: 'admin' });
      // A state no command leaves: the inviter's role dropped, the invitation still pending.
      await app.plant('membership', adminId, { role: 'viewer' });
      expect(refusalOfAttempt(await acceptAs(app, invitee, mine.token ?? ''))?.code).toBe(invalid);
      expect((await app.row('invitation', mine.id))?.status).toBe('pending');
      const members = await app.as(founder).invoke('members.membership.query', {});
      expect(members.items).toHaveLength(2);
      // The same invitation is good again once its inviter is an admin: the check is the live role.
      await app.plant('membership', adminId, { role: 'admin' });
      expect((await acceptAs(app, invitee, mine.token ?? '')).ok).toBe(true);
    });
  },
);
