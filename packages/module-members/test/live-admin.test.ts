import { describe, expect, onTestFinished, test } from 'vitest';
import { type BootedMembers, bootMembers, type MembersStorage } from './support/boot-members.ts';
import {
  admin,
  bringUpOwner,
  callOnSession,
  founder,
  invitee,
  joinAs,
  refusalOfAttempt,
  sessionOpenedNow,
} from './support/member-calls.ts';

describe.each(['memory', 'pglite'] as const)('live memberships on %s', (kind: MembersStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedMembers> {
    const app = await bootMembers(kind);
    onTestFinished(() => app.runtime.stop());
    await bringUpOwner(app);
    return app;
  }

  const kindOf = (outcome: { ok: boolean; error?: { kind: string } }) => outcome.error?.kind;

  test('M7: a removed admin whose session is still open issues no invitation and no token', {
    timeout,
  }, async () => {
    const app = await boot();
    const adminId = await joinAs(app, admin, 'admin', 'admin@example.com');
    const stale = await sessionOpenedNow(app, admin);
    // The session still carries the admin membership it was opened with.
    expect(stale.principal.memberships).toHaveLength(1);
    const removed = await app
      .as(founder)
      .attempt('members.membership.removeMember', { id: adminId as never });
    if (!removed.ok) throw removed.error;
    const refused = await callOnSession(app, stale, admin, 'members.invitation.invite', {
      email: 'new@example.com',
      role: 'admin',
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? undefined : refused.error.kind).toBe('forbidden');
    // Only the two invitations that were accepted exist: the refused call left no row and no token.
    expect((await app.invitations()).map((row) => row.status)).toEqual(['accepted', 'accepted']);
  });

  test('M8: a demoted admin cannot grant roles or remove members, a live admin can', {
    timeout,
  }, async () => {
    const app = await boot();
    const adminId = await joinAs(app, admin, 'admin', 'admin@example.com');
    const memberId = await joinAs(app, invitee, 'member', 'member@example.com');
    // A session opened while the person was an admin keeps the admin membership.
    const stale = await sessionOpenedNow(app, admin);
    const demoted = await app
      .as(founder)
      .attempt('members.membership.changeRole', { id: adminId as never, role: 'member' });
    if (!demoted.ok) throw demoted.error;
    const grant = await callOnSession(app, stale, admin, 'members.membership.changeRole', {
      id: adminId,
      role: 'admin',
    });
    expect(grant.ok ? undefined : grant.error.kind).toBe('forbidden');
    const remove = await callOnSession(app, stale, admin, 'members.membership.removeMember', {
      id: memberId,
    });
    expect(remove.ok ? undefined : remove.error.kind).toBe('forbidden');
    expect((await app.row('membership', adminId))?.role).toBe('member');
    expect((await app.row('membership', memberId))?.role).toBe('member');
    // An admin who is one now does both.
    const restored = await app
      .as(founder)
      .attempt('members.membership.changeRole', { id: adminId as never, role: 'admin' });
    if (!restored.ok) throw restored.error;
    const viewer = await app
      .as(admin)
      .attempt('members.membership.changeRole', { id: memberId as never, role: 'viewer' });
    if (!viewer.ok) throw viewer.error;
    expect((await app.row('membership', memberId))?.role).toBe('viewer');
    const gone = await app
      .as(admin)
      .attempt('members.membership.removeMember', { id: memberId as never });
    if (!gone.ok) throw gone.error;
    expect(await app.row('membership', memberId)).toBeUndefined();
  });

  test('M9: on the owner row, changeRole and removeMember answer not_found, and no one gets owner by a role change', {
    timeout,
  }, async () => {
    const app = await boot();
    const adminId = await joinAs(app, admin, 'admin', 'admin@example.com');
    const owner = (await app.as(founder).invoke('members.membership.query', {})).items.find(
      (row) => row.role === 'owner',
    );
    if (owner === undefined) throw new Error('no owner');
    for (const who of [founder, admin]) {
      const demote = await app
        .as(who)
        .attempt('members.membership.changeRole', { id: owner.id, role: 'member' });
      expect(refusalOfAttempt(demote)?.kind).toBe('not_found');
      const remove = await app.as(who).attempt('members.membership.removeMember', { id: owner.id });
      expect(refusalOfAttempt(remove)?.kind).toBe('not_found');
    }
    const toOwner = await app
      .as(admin)
      .attempt('members.membership.changeRole', { id: adminId as never, role: 'owner' as never });
    expect(kindOf(toOwner)).toBe('validation');
    expect((await app.row('membership', adminId))?.role).toBe('admin');
  });

  test('the generated update and archive of a membership are no longer open to any user', {
    timeout,
  }, async () => {
    const app = await boot();
    const memberId = await joinAs(app, invitee, 'member', 'member@example.com');
    for (const who of [founder, invitee]) {
      const update = await app.as(who).attempt('members.membership.update', {
        id: memberId as never,
        ifVersion: 1,
        patch: { role: 'admin' },
      });
      expect(refusalOfAttempt(update)?.kind).toBe('forbidden');
      const archive = await app
        .as(who)
        .attempt('members.membership.archive', { id: memberId as never });
      expect(refusalOfAttempt(archive)?.kind).toBe('forbidden');
    }
    expect((await app.row('membership', memberId))?.role).toBe('member');
  });
});
