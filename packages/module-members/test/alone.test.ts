import { describe, expect, onTestFinished, test } from 'vitest';
import {
  type BootedMembers,
  bootInstant,
  bootMembers,
  type MembersStorage,
} from './support/boot-members.ts';
import {
  acceptAs,
  bringUpOwner,
  founder,
  inviteAs,
  invitee,
  refusalOfAttempt,
  stranger,
} from './support/member-calls.ts';

describe.each(['memory', 'pglite'] as const)('members alone on %s', (kind: MembersStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedMembers> {
    const app = await bootMembers(kind);
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  test('bring-up: the operator invites the owner, who accepts and holds the owner role', {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await app
      .operator()
      .attempt('members.invitation.createOwner', { email: 'founder@example.com' });
    if (!invited.ok) throw invited.error;
    const { id, token } = invited.value as { id: string; token?: string };
    expect(token).toMatch(/^kwi_[a-z2-7]{26}_/);
    expect((await app.row('invitation', id))?.status).toBe('pending');
    const accepted = await acceptAs(app, founder, token ?? '');
    if (!accepted.ok) throw accepted.error;
    const { membershipId, role } = accepted.value as { membershipId: string; role: string };
    expect(role).toBe('owner');
    expect(await app.row('membership', membershipId)).toMatchObject({ role: 'owner' });
    expect(await app.row('invitation', id)).toMatchObject({
      status: 'accepted',
      email: 'founder@example.com',
    });
    // The owner now reads the members and the invitations.
    const members = await app.as(founder).attempt('members.membership.query', {});
    expect(members.ok).toBe(true);
  });

  test('the owner invites a user, who accepts with the token, gains the member role and is admitted by a rule using hasRole', {
    timeout,
  }, async () => {
    const app = await boot();
    await bringUpOwner(app);
    const refusedBefore = await app.as(invitee).attempt('bulletin.pinNotice', { text: 'hi' });
    expect(refusalOfAttempt(refusedBefore)?.kind).toBe('forbidden');
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    expect(invited.token).toBeDefined();
    const accepted = await acceptAs(app, invitee, invited.token ?? '');
    if (!accepted.ok) throw accepted.error;
    expect((accepted.value as { role: string }).role).toBe('member');
    expect((await app.as(invitee).attempt('bulletin.pinNotice', { text: 'hi' })).ok).toBe(true);
    expect(
      refusalOfAttempt(await app.as(stranger).attempt('bulletin.pinNotice', { text: 'hi' }))?.kind,
    ).toBe('forbidden');
  });

  test('the owner cannot be removed or demoted', { timeout }, async () => {
    const app = await boot();
    await bringUpOwner(app);
    const owners = await app.as(founder).attempt('members.membership.query', {});
    if (!owners.ok) throw owners.error;
    const [owner] = owners.value.items;
    if (owner === undefined) throw new Error('no owner row');
    const archived = await app.as(founder).attempt('members.membership.archive', { id: owner.id });
    expect(refusalOfAttempt(archived)?.kind).toBe('not_found');
    const demoted = await app.as(founder).attempt('members.membership.update', {
      id: owner.id,
      ifVersion: owner.version,
      patch: { role: 'member' },
    });
    expect(refusalOfAttempt(demoted)?.kind).toBe('not_found');
    expect(await app.row('membership', owner.id)).toMatchObject({ role: 'owner' });
    expect((await app.row('membership', owner.id))?.archivedAt ?? null).toBeNull();
  });

  test('an expired invitation is refused', { timeout }, async () => {
    const app = await boot();
    await bringUpOwner(app);
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    await app.runtime.advanceTo(bootInstant.add({ hours: 7 * 24, minutes: 1 }));
    expect(await app.row('invitation', invited.id)).toMatchObject({ status: 'expired' });
    const refused = await acceptAs(app, invitee, invited.token ?? '');
    expect(refusalOfAttempt(refused)?.code).toBe('members.invitation_invalid');
    const members = await app.as(founder).attempt('members.membership.query', {});
    if (!members.ok) throw members.error;
    expect(members.value.items).toHaveLength(1);
  });
});
