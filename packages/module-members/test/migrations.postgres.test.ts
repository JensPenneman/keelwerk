import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type BootedMembers, bootMembers } from './support/boot-members.ts';
import { holdTableLock, waitForLockWaiters } from './support/hold-table-lock.ts';
import {
  acceptAs,
  bringUpOwner,
  founder,
  inviteAs,
  invitee,
  stranger,
} from './support/member-calls.ts';

describe('members on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let app: BootedMembers;

  beforeAll(async () => {
    postgres = await startPostgres();
    app = await bootMembers('memory', {
      external: { factory: postgresAdapter({ ownerUrl: postgres.adminUrl }), url: postgres.appUrl },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.runtime.stop();
    await postgres?.stop();
  });

  test('on PostgreSQL the migration applies, the owner is brought up and a member accepts', async () => {
    await bringUpOwner(app);
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    const accepted = await acceptAs(app, invitee, invited.token ?? '');
    if (!accepted.ok) throw accepted.error;
    const { membershipId } = accepted.value as { membershipId: string };
    expect(await app.row('membership', membershipId)).toMatchObject({ role: 'member' });
    expect((await app.row('invitation', invited.id))?.status).toBe('accepted');
    const again = await acceptAs(app, invitee, invited.token ?? '');
    expect(again.ok).toBe(false);
  });

  test('accepting ends the invitation: its key is shredded and the membership stays live', async () => {
    const invited = await inviteAs(app, founder, { email: 'grace@example.com', role: 'viewer' });
    expect((await app.keysOf(invited.id)).live).toBe(true);
    const accepted = await acceptAs(app, stranger, invited.token ?? '');
    if (!accepted.ok) throw accepted.error;
    const { membershipId } = accepted.value as { membershipId: string };
    await app.settle();
    const keys = await app.keysOf(invited.id);
    expect(keys.live).toBe(false);
    expect(keys.shredded).toBeGreaterThan(0);
    expect(await app.row('membership', membershipId)).toMatchObject({ role: 'viewer' });
    expect((await app.row('invitation', invited.id))?.email).toBe('grace@example.com');
  });

  test('T4: two createOwner calls at once leave one live owner invitation, two accepts at once one owner', async () => {
    const tenant = 'globex';
    const operator = app.operator(tenant);
    // Both commands read the tenant before either writes an invitation.
    const invitationLock = await holdTableLock(postgres.adminUrl, 'members__invitation');
    const calls = ['first@example.com', 'second@example.com'].map((email) =>
      operator.attempt('members.invitation.createOwner', { email }),
    );
    await waitForLockWaiters(postgres.adminUrl, 2);
    await invitationLock.release();
    const issued = await Promise.all(calls);
    for (const call of issued) expect(call.ok).toBe(true);
    const pending = (await app.invitations(tenant)).filter(
      (row) => row.status === 'pending' && row.role === 'owner',
    );
    expect(pending).toHaveLength(1);
    const token = issued
      .flatMap((call) => (call.ok ? [call.value as { id: string; token?: string }] : []))
      .find((value) => value.id === pending[0]?.id)?.token;
    expect(token).toBeDefined();
    // Two people accept the one owner invitation at the same moment: one owner results.
    const membershipLock = await holdTableLock(postgres.adminUrl, 'members__membership');
    const accepts = [founder, stranger].map((person) =>
      app.as(person, tenant).attempt('members.invitation.accept', { token: token ?? '' }),
    );
    await waitForLockWaiters(postgres.adminUrl, 1);
    await membershipLock.release();
    const answers = await Promise.all(accepts);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    const loser = answers.find((answer) => !answer.ok);
    expect(loser?.ok ? undefined : loser?.error.code).toBe('members.invitation_invalid');
    expect(await app.ownerCount(tenant)).toBe(1);
  }, 90_000);

  test('T4: the store itself refuses a second owner row', async () => {
    const owners = await app.as(founder).invoke('members.membership.query', {});
    const member = owners.items.find((row) => row.role === 'member');
    if (member === undefined) throw new Error('no member');
    await expect(app.plant('membership', member.id, { role: 'owner' })).rejects.toThrow();
    expect(await app.ownerCount()).toBe(1);
  });
});
