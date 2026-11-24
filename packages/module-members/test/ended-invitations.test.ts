import { findPlaintext } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  type BootedMembers,
  bootInstant,
  bootMembers,
  type MembersStorage,
} from './support/boot-members.ts';
import { erasuresHeld } from './support/hold/module.ts';
import {
  acceptAs,
  admin,
  bringUpOwner,
  erasuresOf,
  founder,
  inviteAs,
  invitee,
  joinAs,
  refusalOfAttempt,
  secondAdmin,
  stranger,
  viewer,
} from './support/member-calls.ts';

const invalid = 'members.invitation_invalid';

describe.each(['memory', 'pglite'] as const)('ended invitations on %s', (kind: MembersStorage) => {
  const address = 'ada.lovelace@example.com';

  async function boot(): Promise<BootedMembers> {
    const app = await bootMembers(kind);
    onTestFinished(() => app.runtime.stop());
    await bringUpOwner(app);
    return app;
  }

  const withdraw = (
    app: BootedMembers,
    who: Parameters<BootedMembers['as']>[0],
    id: string,
    ifVersion = 1,
  ) =>
    app.as(who).attempt('members.invitation.update', {
      id: id as never,
      ifVersion,
      patch: { status: 'withdrawn' },
    });

  /** Nothing of the address is left under the invitation's key, in the row, the records or the store. */
  async function expectErased(app: BootedMembers, id: string, digest: string | undefined) {
    expect(await app.row('invitation', id)).toBeUndefined();
    const keys = await app.keysOf(id);
    expect(keys.live).toBe(false);
    expect(keys.shredded).toBeGreaterThan(0);
    expect((await app.sealsOf('invitation', id)).filter((seal) => seal.openable)).toEqual([]);
    expect((await erasuresOf(app)).filter((record) => record.subjectId === id)).toHaveLength(1);
    if (kind === 'pglite') {
      const dump = await app.dumpOf();
      expect(findPlaintext(dump, [address, 'ada.lovelace'])).toEqual([]);
      if (digest !== undefined) expect(dump).not.toContain(digest);
    }
  }

  test('M2: an expired invitation loses its address and its key, and its address is invited again', async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: address, role: 'member' });
    const digest = await app.digestOf(invited.id);
    await app.runtime.advanceTo(bootInstant.add({ hours: 7 * 24, minutes: 1 }));
    // Between the commit that ends it and the worker it reads with its status and no address.
    const between = await app.row('invitation', invited.id);
    expect(between?.status).toBe('expired');
    expect(between?.email ?? null).toBeNull();
    await app.settle();
    await expectErased(app, invited.id, digest);
    const again = await inviteAs(app, founder, { email: address, role: 'viewer' });
    expect((await app.row('invitation', again.id))?.status).toBe('pending');
  });

  test('M3: the inviter withdraws, and the invitation is ended the same way; a person who is no admin cannot, and its token is dead', async () => {
    const app = await boot();
    await joinAs(app, admin, 'admin', 'admin@example.com');
    await joinAs(app, viewer, 'viewer', 'viewer@example.com');
    const byAdmin = await inviteAs(app, admin, { email: address, role: 'member' });
    const digest = await app.digestOf(byAdmin.id);
    expect(refusalOfAttempt(await withdraw(app, viewer, byAdmin.id))?.kind).toBe('not_found');
    expect(refusalOfAttempt(await withdraw(app, stranger, byAdmin.id))?.kind).toBe('not_found');
    const withdrawn = await withdraw(app, admin, byAdmin.id);
    if (!withdrawn.ok) throw withdrawn.error;
    const between = await app.row('invitation', byAdmin.id);
    expect(between?.status).toBe('withdrawn');
    expect(between?.email ?? null).toBeNull();
    expect(refusalOfAttempt(await acceptAs(app, invitee, byAdmin.token ?? ''))?.code).toBe(invalid);
    await app.settle();
    await expectErased(app, byAdmin.id, digest);
    expect(refusalOfAttempt(await acceptAs(app, invitee, byAdmin.token ?? ''))?.code).toBe(invalid);
  });

  test('M3a: the owner and another admin withdraw an invitation an admin issued', async () => {
    const app = await boot();
    await joinAs(app, admin, 'admin', 'admin@example.com');
    await joinAs(app, secondAdmin, 'admin', 'second@example.com');
    const forOwner = await inviteAs(app, admin, { email: 'a@example.com', role: 'member' });
    const forSecond = await inviteAs(app, admin, { email: 'b@example.com', role: 'viewer' });
    for (const [who, invited] of [
      [founder, forOwner],
      [secondAdmin, forSecond],
    ] as const) {
      const withdrawn = await withdraw(app, who, invited.id);
      if (!withdrawn.ok) throw withdrawn.error;
      expect(refusalOfAttempt(await acceptAs(app, invitee, invited.token ?? ''))?.code).toBe(
        invalid,
      );
    }
    await app.settle();
    expect(await app.row('invitation', forOwner.id)).toBeUndefined();
    expect(await app.row('invitation', forSecond.id)).toBeUndefined();
  });

  test('M3c: in a tenant whose owner was erased, an admin cannot withdraw the owner invitation of the operator, and its token still accepts', async () => {
    const app = await boot();
    await joinAs(app, admin, 'admin', 'admin@example.com');
    await app
      .operator()
      .invoke(
        'core.eraseSubject',
        { subjectId: founder.subject, reason: 'subjectRequest' } as never,
        { prefer: 'async' } as never,
      );
    await app.settle();
    const forOwner = await app
      .operator()
      .invoke('members.invitation.createOwner', { email: 'next-owner@example.com' });
    expect((await app.row('invitation', forOwner.id))?.status).toBe('pending');
    // The admin does not even see it as a withdrawable row: the call answers not_found.
    expect(refusalOfAttempt(await withdraw(app, admin, forOwner.id))?.kind).toBe('not_found');
    expect((await app.row('invitation', forOwner.id))?.status).toBe('pending');
    const accepted = await acceptAs(app, invitee, forOwner.token ?? '');
    if (!accepted.ok) throw accepted.error;
    expect((await app.row('invitation', forOwner.id))?.status).toBe('accepted');
  });

  test('M3b: a removed inviter withdraws nothing; a demoted inviter, now a member, still withdraws their own', async () => {
    const app = await boot();
    const adminId = await joinAs(app, admin, 'admin', 'admin@example.com');
    const mine = await inviteAs(app, admin, { email: address, role: 'member' });
    const removed = await app
      .as(founder)
      .attempt('members.membership.removeMember', { id: adminId as never });
    if (!removed.ok) throw removed.error;
    // Removing the inviter ended the invitation; put it back, as a state the rule alone must answer.
    await app.plant('invitation', mine.id, { status: 'pending' });
    const version = Number((await app.row('invitation', mine.id))?.version);
    expect(refusalOfAttempt(await withdraw(app, admin, mine.id, version))?.kind).toBe('not_found');
    expect((await app.row('invitation', mine.id))?.status).toBe('pending');
    // The same person, signed in again as a member of the tenant, withdraws it.
    await joinAs(app, admin, 'member', 'again@example.com');
    const withdrawn = await withdraw(app, admin, mine.id, version);
    if (!withdrawn.ok) throw withdrawn.error;
    expect((await app.row('invitation', mine.id))?.status).toBe('withdrawn');
  });

  test('M4: an invitation retired by invite and one withdrawn by createOwner are erased', async () => {
    const app = await bootMembers(kind);
    onTestFinished(() => app.runtime.stop());
    // createOwner twice: the first owner invitation is withdrawn by the repeat.
    const first = await app.operator().invoke('members.invitation.createOwner', { email: address });
    const digest = await app.digestOf(first.id);
    const second = await app
      .operator()
      .invoke('members.invitation.createOwner', { email: 'second@example.com' });
    await app.settle();
    await expectErased(app, first.id, digest);
    expect((await app.row('invitation', second.id))?.status).toBe('pending');
    // invite retires a pending invitation whose expiry passed before its timer ran.
    expect((await acceptAs(app, founder, second.token ?? '')).ok).toBe(true);
    const old = await inviteAs(app, founder, { email: 'old@example.com', role: 'member' });
    await app.plant('invitation', old.id, { expiresAt: bootInstant.subtract({ hours: 1 }) });
    await inviteAs(app, founder, { email: 'old@example.com', role: 'viewer' });
    expect((await app.row('invitation', old.id))?.status).toBe('expired');
    await app.settle();
    expect(await app.row('invitation', old.id)).toBeUndefined();
    expect((await app.keysOf(old.id)).live).toBe(false);
  });

  test('M6: the timer that fires after a withdrawal writes no second erasure', async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: address, role: 'member' });
    const withdrawn = await withdraw(app, founder, invited.id);
    if (!withdrawn.ok) throw withdrawn.error;
    await app.settle();
    await app.runtime.advanceTo(invited.expiresAt.add({ minutes: 1 }));
    await app.settle();
    expect(
      (await erasuresOf(app)).filter((record) => record.subjectId === invited.id),
    ).toHaveLength(1);
  });

  test('M5: a hold on erasures does not stop the expiry; the invitation is erased once the hold lifts', async () => {
    const app = await bootMembers(kind, { held: true });
    onTestFinished(() => {
      erasuresHeld.on = false;
      return app.runtime.stop();
    });
    await bringUpOwner(app);
    const invited = await inviteAs(app, founder, { email: address, role: 'member' });
    const digest = await app.digestOf(invited.id);
    erasuresHeld.on = true;
    const expiry = bootInstant.add({ hours: 7 * 24, minutes: 1 });
    await app.runtime.advanceTo(expiry);
    await app.settle();
    // The invitation ended although the erasure may not start: no address, no token, and the key waits.
    const between = await app.row('invitation', invited.id);
    expect(between?.status).toBe('expired');
    expect(between?.email ?? null).toBeNull();
    expect(refusalOfAttempt(await acceptAs(app, invitee, invited.token ?? ''))?.code).toBe(invalid);
    expect((await app.keysOf(invited.id)).live).toBe(true);
    expect((await erasuresOf(app)).filter((record) => record.subjectId === invited.id)).toEqual([]);
    await app.runtime.advanceTo(expiry.add({ hours: 2 }));
    await app.settle();
    expect((await app.keysOf(invited.id)).live).toBe(true);
    erasuresHeld.on = false;
    await app.runtime.advanceTo(expiry.add({ hours: 4 }));
    await app.settle();
    await expectErased(app, invited.id, digest);
    // The address can be invited again.
    const again = await inviteAs(app, founder, { email: address, role: 'viewer' });
    expect((await app.row('invitation', again.id))?.status).toBe('pending');
  });
});
