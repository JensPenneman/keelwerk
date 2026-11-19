import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type BootedMembers, bootMembers } from './support/boot-members.ts';
import { acceptAs, bringUpOwner, founder, inviteAs, invitee } from './support/member-calls.ts';

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
});
