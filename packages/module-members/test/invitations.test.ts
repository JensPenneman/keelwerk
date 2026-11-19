import { describe, expect, onTestFinished, test } from 'vitest';
import {
  type BootedMembers,
  bootInstant,
  bootMembers,
  type MembersStorage,
} from './support/boot-members.ts';
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
  viewer,
} from './support/member-calls.ts';

const invalid = 'members.invitation_invalid';

describe.each(['memory', 'pglite'] as const)('invitations on %s', (kind: MembersStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedMembers> {
    const app = await bootMembers(kind);
    onTestFinished(() => app.runtime.stop());
    await bringUpOwner(app);
    return app;
  }

  const withdraw = (app: BootedMembers, who: Parameters<BootedMembers['as']>[0], id: string) =>
    app.as(who).attempt('members.invitation.update', {
      id: id as never,
      ifVersion: 1,
      patch: { status: 'withdrawn' },
    });

  test('only the inviter withdraws a pending invitation, and a withdrawn one cannot be accepted', {
    timeout,
  }, async () => {
    const app = await boot();
    await joinAs(app, admin, 'admin', 'admin@example.com');
    const byAdmin = await inviteAs(app, admin, { email: 'ada@example.com', role: 'member' });
    // The owner did not invite it: the invitation is out of the owner's reach.
    expect(refusalOfAttempt(await withdraw(app, founder, byAdmin.id))?.kind).toBe('not_found');
    expect(refusalOfAttempt(await withdraw(app, stranger, byAdmin.id))?.kind).toBe('not_found');
    const withdrawn = await withdraw(app, admin, byAdmin.id);
    if (!withdrawn.ok) throw withdrawn.error;
    expect((await app.row('invitation', byAdmin.id))?.status).toBe('withdrawn');
    expect(refusalOfAttempt(await acceptAs(app, invitee, byAdmin.token ?? ''))?.code).toBe(invalid);
  });

  test('the withdraw rule moves a pending invitation to withdrawn and to nothing else', {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    const toAccepted = await app.as(founder).attempt('members.invitation.update', {
      id: invited.id,
      ifVersion: 1,
      patch: { status: 'accepted' },
    });
    expect(refusalOfAttempt(toAccepted)?.kind).toBe('forbidden');
    expect((await app.row('invitation', invited.id))?.status).toBe('pending');
  });

  test('the withdraw rule changes the status and no other member of the invitation', {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    const widened = await app.as(founder).attempt('members.invitation.update', {
      id: invited.id,
      ifVersion: 1,
      patch: { status: 'withdrawn', role: 'admin' },
    });
    expect(widened.ok).toBe(false);
    expect(await app.row('invitation', invited.id)).toMatchObject({
      status: 'pending',
      role: 'member',
    });
  });

  test('an invitation past its expiry is refused before its timer has run, and its address is invited again', {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    await app.plant('invitation', invited.id, { expiresAt: bootInstant.subtract({ hours: 1 }) });
    expect((await app.row('invitation', invited.id))?.status).toBe('pending');
    expect(refusalOfAttempt(await acceptAs(app, invitee, invited.token ?? ''))?.code).toBe(invalid);
    const again = await inviteAs(app, founder, { email: 'ada@example.com', role: 'viewer' });
    expect((await app.row('invitation', invited.id))?.status).toBe('expired');
    expect((await app.row('invitation', again.id))?.status).toBe('pending');
  });

  test('a second accept of one invitation is refused, by the same person and by another', {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    const first = await acceptAs(app, invitee, invited.token ?? '');
    expect(first.ok).toBe(true);
    expect(refusalOfAttempt(await acceptAs(app, invitee, invited.token ?? ''))?.code).toBe(invalid);
    expect(refusalOfAttempt(await acceptAs(app, stranger, invited.token ?? ''))?.code).toBe(
      invalid,
    );
    const members = await app.as(founder).invoke('members.membership.query', {});
    expect(members.items).toHaveLength(2);
  });

  test('createOwner is operator-only, refuses a tenant with an owner, and a repeat withdraws the earlier owner invitation', {
    timeout,
  }, async () => {
    const app = await bootMembers(kind);
    onTestFinished(() => app.runtime.stop());
    const input = { email: 'first@example.com' };
    expect(
      refusalOfAttempt(await app.as(founder).attempt('members.invitation.createOwner', input))
        ?.kind,
    ).toBe('forbidden');
    const first = await app.operator().invoke('members.invitation.createOwner', input);
    const second = await app
      .operator()
      .invoke('members.invitation.createOwner', { email: 'second@example.com' });
    expect((await app.row('invitation', first.id))?.status).toBe('withdrawn');
    expect((await app.row('invitation', second.id))?.status).toBe('pending');
    expect(refusalOfAttempt(await acceptAs(app, founder, first.token ?? ''))?.code).toBe(invalid);
    expect((await acceptAs(app, founder, second.token ?? '')).ok).toBe(true);
    const again = await app.operator().attempt('members.invitation.createOwner', input);
    expect(refusalOfAttempt(again)).toMatchObject({
      kind: 'conflict',
      message: 'This tenant already has an owner.',
    });
  });

  test('a second pending invitation for one address is refused without naming it, and after expiry the address is invited again', {
    timeout,
  }, async () => {
    const app = await boot();
    const address = 'ada.lovelace@example.com';
    const first = await inviteAs(app, founder, { email: address, role: 'member' });
    for (const email of [address, address.toUpperCase()]) {
      const refused = await app
        .as(founder)
        .attempt('members.invitation.invite', { email, role: 'viewer' });
      const refusal = refusalOfAttempt(refused);
      expect(refusal?.kind).toBe('conflict');
      expect(JSON.stringify(refusal).toLowerCase()).not.toContain('ada.lovelace');
    }
    await app.runtime.advanceTo(bootInstant.add({ hours: 7 * 24, minutes: 1 }));
    expect((await app.row('invitation', first.id))?.status).toBe('expired');
    const again = await inviteAs(app, founder, { email: address, role: 'viewer' });
    expect((await app.row('invitation', again.id))?.status).toBe('pending');
    expect(refusalOfAttempt(await acceptAs(app, invitee, first.token ?? ''))?.code).toBe(invalid);
  });

  test('accept refuses a member and a second owner', { timeout }, async () => {
    const app = await boot();
    await joinAs(app, invitee, 'member', 'ada@example.com');
    const again = await inviteAs(app, founder, { email: 'other@example.com', role: 'viewer' });
    expect(refusalOfAttempt(await acceptAs(app, invitee, again.token ?? ''))).toMatchObject({
      kind: 'conflict',
      message: 'You are already a member of this tenant.',
    });
    // An owner invitation that survived the bring-up, planted: no command makes one beside an owner.
    const planted = await inviteAs(app, founder, { email: 'owner@example.com', role: 'admin' });
    await app.plant('invitation', planted.id, { role: 'owner' });
    expect(refusalOfAttempt(await acceptAs(app, stranger, planted.token ?? ''))).toMatchObject({
      kind: 'conflict',
      message: 'This tenant already has an owner.',
    });
    expect((await app.row('invitation', planted.id))?.status).toBe('pending');
  });

  test('an invitation of one tenant is not accepted in another', { timeout }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    const elsewhere = await app
      .as(invitee, 'globex')
      .attempt('members.invitation.accept', { token: invited.token ?? '' });
    expect(refusalOfAttempt(elsewhere)?.code).toBe(invalid);
    expect((await acceptAs(app, invitee, invited.token ?? '')).ok).toBe(true);
  });

  test('a member or viewer cannot invite', { timeout }, async () => {
    const app = await boot();
    await joinAs(app, invitee, 'member', 'member@example.com');
    await joinAs(app, viewer, 'viewer', 'viewer@example.com');
    for (const person of [invitee, viewer, stranger]) {
      const refused = await app
        .as(person)
        .attempt('members.invitation.invite', { email: 'x@example.com', role: 'viewer' });
      expect(refusalOfAttempt(refused)?.kind).toBe('forbidden');
    }
    // Only admins and the owner read invitations: the same read is allowed to the founder and
    // refused as forbidden (no rule allows it) to the member and the viewer.
    const founderRead = await app.as(founder).attempt('members.invitation.query', {});
    if (!founderRead.ok) throw founderRead.error;
    expect(founderRead.value.items.length).toBeGreaterThan(0);
    for (const person of [invitee, viewer]) {
      const read = await app.as(person).attempt('members.invitation.query', {});
      expect(refusalOfAttempt(read)?.kind).toBe('forbidden');
    }
  });
});
