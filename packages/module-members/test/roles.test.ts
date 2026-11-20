import { testCarrier } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { type BootedMembers, bootMembers } from './support/boot-members.ts';
import {
  admin,
  bringUpOwner,
  founder,
  invitee,
  joinAs,
  refusalOfAttempt,
  stranger,
} from './support/member-calls.ts';

describe('roles', () => {
  async function boot(): Promise<BootedMembers> {
    const app = await bootMembers('memory');
    onTestFinished(() => app.runtime.stop());
    await bringUpOwner(app);
    return app;
  }

  test('the enricher adds the role and the membership, and a role change is observed at the next revalidation', async () => {
    const app = await boot();
    const membershipId = await joinAs(app, invitee, 'member', 'ada@example.com');
    const carrier = testCarrier(app.runtime.tenants.acme, invitee);
    const opened = await app.runtime.invoker.open(carrier);
    if (!opened.ok) throw opened.error;
    expect(opened.value.principal.roles).toEqual(['member']);
    expect(opened.value.principal.memberships).toEqual([
      { kind: 'members.membership', id: membershipId, role: 'member' },
    ]);
    const changed = await app
      .as(founder)
      .attempt('members.membership.changeRole', { id: membershipId as never, role: 'admin' });
    if (!changed.ok) throw changed.error;
    // The open session keeps what it was opened with, a revalidation reads the new role.
    expect(opened.value.principal.roles).toEqual(['member']);
    const again = await opened.value.revalidate();
    if (!again.ok) throw again.error;
    expect(again.value.principal.roles).toEqual(['admin']);
    expect(again.value.principal.memberships).toEqual([
      { kind: 'members.membership', id: membershipId, role: 'admin' },
    ]);
    // A person without a membership gets neither, here and in another tenant.
    const nobody = await app.runtime.invoker.open(testCarrier(app.runtime.tenants.acme, stranger));
    if (!nobody.ok) throw nobody.error;
    expect(nobody.value.principal.roles).toEqual([]);
    expect(nobody.value.principal.memberships).toEqual([]);
    const elsewhere = await app.runtime.invoker.open(
      testCarrier(app.runtime.tenants.globex, invitee),
    );
    if (!elsewhere.ok) throw elsewhere.error;
    expect(elsewhere.value.principal.roles).toEqual([]);
    expect(elsewhere.value.principal.memberships).toEqual([]);
  });

  test('a signed-in user at backend scope opens a session without a membership', async () => {
    const app = await boot();
    await joinAs(app, invitee, 'member', 'ada@example.com');
    // The same person with the backend named and no tenant: a backend-scope session.
    const { 'x-tenant': _tenant, ...headers } = testCarrier(app.runtime.tenants.acme, invitee)
      .headers as Record<string, string>;
    const carrier = {
      transport: 'test',
      headers: { ...headers, 'x-backend': app.runtime.backendId },
    };
    const opened = await app.runtime.invoker.open(carrier);
    if (!opened.ok) throw opened.error;
    expect(opened.value.principal.scope.tenant).toBeNull();
    expect(opened.value.principal.roles).toEqual([]);
    expect(opened.value.principal.memberships).toEqual([]);
  });

  test('admins change roles but never to owner; ownership moves only through transferOwnership and the former owner becomes admin', async () => {
    const app = await boot();
    const adminId = await joinAs(app, admin, 'admin', 'admin@example.com');
    const memberId = await joinAs(app, invitee, 'member', 'member@example.com');
    const owner = (await app.as(founder).invoke('members.membership.query', {})).items.find(
      (row) => row.role === 'owner',
    );
    if (owner === undefined) throw new Error('no owner');
    // An admin changes a role, but not to owner, and cannot touch the owner row.
    const toViewer = await app
      .as(admin)
      .attempt('members.membership.changeRole', { id: memberId as never, role: 'viewer' });
    expect(toViewer.ok).toBe(true);
    // The input cannot name the owner role.
    const toOwner = await app
      .as(admin)
      .attempt('members.membership.changeRole', { id: memberId as never, role: 'owner' as never });
    expect(refusalOfAttempt(toOwner)?.kind).toBe('validation');
    expect((await app.row('membership', memberId))?.role).toBe('viewer');
    const onOwner = await app
      .as(admin)
      .attempt('members.membership.changeRole', { id: owner.id, role: 'member' });
    expect(refusalOfAttempt(onOwner)?.kind).toBe('not_found');
    // A member cannot change roles, and an admin cannot move ownership.
    const byMember = await app
      .as(invitee)
      .attempt('members.membership.changeRole', { id: adminId as never, role: 'viewer' });
    expect(refusalOfAttempt(byMember)?.kind).toBe('forbidden');
    const byAdmin = await app
      .as(admin)
      .attempt('members.membership.transferOwnership', { id: adminId as never });
    expect(refusalOfAttempt(byAdmin)?.kind).toBe('forbidden');
    // The owner cannot give ownership to itself; it moves to the admin, and the owner becomes admin.
    const toSelf = await app
      .as(founder)
      .attempt('members.membership.transferOwnership', { id: owner.id });
    expect(refusalOfAttempt(toSelf)).toMatchObject({
      kind: 'validation',
      message: 'You already own this tenant.',
    });
    const moved = await app
      .as(founder)
      .attempt('members.membership.transferOwnership', { id: adminId as never });
    if (!moved.ok) throw moved.error;
    expect((await app.row('membership', adminId))?.role).toBe('owner');
    expect((await app.row('membership', owner.id))?.role).toBe('admin');
    // The former owner holds no ownership any more, the new owner cannot be removed.
    const again = await app
      .as(founder)
      .attempt('members.membership.transferOwnership', { id: memberId as never });
    expect(refusalOfAttempt(again)?.kind).toBe('forbidden');
    const removed = await app
      .as(founder)
      .attempt('members.membership.removeMember', { id: adminId as never });
    expect(refusalOfAttempt(removed)?.kind).toBe('not_found');
  });
});
