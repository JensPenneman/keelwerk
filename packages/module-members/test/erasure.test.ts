import { describe, expect, onTestFinished, test } from 'vitest';
import { type BootedMembers, bootMembers, type MembersStorage } from './support/boot-members.ts';
import {
  acceptAs,
  bringUpOwner,
  founder,
  inviteAs,
  invitee,
  inviteeSubject,
} from './support/member-calls.ts';

describe.each(['memory', 'pglite'] as const)('members erasure on %s', (kind: MembersStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;
  const address = 'ada@example.com';

  async function boot(): Promise<BootedMembers> {
    const app = await bootMembers(kind);
    onTestFinished(() => app.runtime.stop());
    await bringUpOwner(app);
    return app;
  }

  test("after the accepting person's keys are shredded the accepted invitation reads without its address", {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: address, role: 'member' });
    expect((await acceptAs(app, invitee, invited.token ?? '')).ok).toBe(true);
    expect(await app.row('invitation', invited.id)).toMatchObject({
      email: address,
      subject: inviteeSubject,
      status: 'accepted',
    });
    await app.shred(inviteeSubject);
    const after = await app.row('invitation', invited.id);
    expect(after?.status).toBe('accepted');
    expect(after?.email ?? null).toBeNull();
  });

  test("after a pending invitation's subject (its id) is shredded it reads without its address", {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: address, role: 'member' });
    expect((await app.row('invitation', invited.id))?.email).toBe(address);
    await app.shred(invited.id);
    const after = await app.row('invitation', invited.id);
    expect(after?.status).toBe('pending');
    expect(after?.email ?? null).toBeNull();
  });
});
