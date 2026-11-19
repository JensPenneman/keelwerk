import { findPlaintext } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { type BootedMembers, bootMembers, type MembersStorage } from './support/boot-members.ts';
import {
  acceptAs,
  bringUpOwner,
  erasuresOf,
  founder,
  inviteAs,
  invitee,
  inviteeSubject,
  refusalOfAttempt,
} from './support/member-calls.ts';

describe.each(['memory', 'pglite'] as const)('members erasure on %s', (kind: MembersStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;
  const address = 'ada.lovelace@example.com';

  async function boot(): Promise<BootedMembers> {
    const app = await bootMembers(kind);
    onTestFinished(() => app.runtime.stop());
    await bringUpOwner(app);
    return app;
  }

  /** Whether a sealed value of the invitation's creation record can still be opened. */
  async function creationOpens(app: BootedMembers, id: string): Promise<boolean> {
    const seals = await app.sealsOf('invitation', id);
    const created = seals.filter((seal) => seal.record === 'members.invitation.created');
    expect(created.length).toBeGreaterThan(0);
    return created.some((seal) => seal.openable);
  }

  test('M1: accepting ends the invitation: its key is shredded, the address stays under the person', {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: address, role: 'member' });
    // Before the end the address opens in the creation record, under the invitation's own key.
    expect(await creationOpens(app, invited.id)).toBe(true);
    expect(await app.keysOf(invited.id)).toMatchObject({ live: true });
    const accepted = await acceptAs(app, invitee, invited.token ?? '');
    if (!accepted.ok) throw accepted.error;
    const { membershipId } = accepted.value as { membershipId: string };
    await app.settle();
    // The row and the membership live on, the address read under the person.
    expect(await app.row('invitation', invited.id)).toMatchObject({
      status: 'accepted',
      subject: inviteeSubject,
      email: address,
    });
    expect(await app.row('membership', membershipId)).toMatchObject({ role: 'member' });
    // The invitation's key is gone, and with it the address in the creation record.
    const keys = await app.keysOf(invited.id);
    expect(keys.live).toBe(false);
    expect(keys.shredded).toBeGreaterThan(0);
    expect(await creationOpens(app, invited.id)).toBe(false);
    expect(await erasuresOf(app)).toContainEqual(
      expect.objectContaining({
        subjectId: invited.id,
        reason: 'retention',
        requester: expect.objectContaining({ kind: 'service', id: 'members.system' }),
      }),
    );
    // The timer that fires at the expiry later finds an accepted invitation and writes no second erasure.
    await app.runtime.advanceTo(invited.expiresAt.add({ minutes: 1 }));
    await app.settle();
    expect(
      (await erasuresOf(app)).filter((record) => record.subjectId === invited.id),
    ).toHaveLength(1);
  });

  test("the person's erasure after accept reaches the accepted invitation and the membership", {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: address, role: 'member' });
    const accepted = await acceptAs(app, invitee, invited.token ?? '');
    if (!accepted.ok) throw accepted.error;
    const { membershipId } = accepted.value as { membershipId: string };
    await app.settle();
    const digest = await app.digestOf(invited.id);
    await app
      .operator()
      .invoke(
        'core.eraseSubject',
        { subjectId: inviteeSubject, reason: 'subjectRequest' } as never,
        { prefer: 'async' } as never,
      );
    await app.settle();
    expect(await app.row('invitation', invited.id)).toBeUndefined();
    expect(await app.row('membership', membershipId)).toBeUndefined();
    expect(await app.keysOf(inviteeSubject)).toMatchObject({ live: false });
    if (kind === 'pglite') {
      const dump = await app.dumpOf();
      expect(findPlaintext(dump, [address, 'ada.lovelace'])).toEqual([]);
      if (digest !== undefined) expect(dump).not.toContain(digest);
    }
  });

  test('E4, E5: an operator erases a pending invitation by its id, and its address is invited again', {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: address, role: 'member' });
    const digest = await app.digestOf(invited.id);
    if (kind === 'pglite') expect(digest).toBeDefined();
    await app
      .operator()
      .invoke(
        'core.eraseSubject',
        { subjectId: invited.id, reason: 'operator' } as never,
        { prefer: 'async' } as never,
      );
    await app.settle();
    expect(await app.row('invitation', invited.id)).toBeUndefined();
    expect((await app.keysOf(invited.id)).live).toBe(false);
    expect(refusalOfAttempt(await acceptAs(app, invitee, invited.token ?? ''))?.code).toBe(
      'members.invitation_invalid',
    );
    if (kind === 'pglite') {
      const dump = await app.dumpOf();
      expect(findPlaintext(dump, [address, 'ada.lovelace'])).toEqual([]);
      if (digest !== undefined) expect(dump).not.toContain(digest);
    }
    const again = await inviteAs(app, founder, { email: address, role: 'viewer' });
    expect((await app.row('invitation', again.id))?.status).toBe('pending');
  });
});
