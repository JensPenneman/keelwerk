import { describe, expect, onTestFinished, test } from 'vitest';
import { bootMembers } from './support/boot-members.ts';
import { acceptAs, founder, invitee } from './support/member-calls.ts';
import { sentInvitations } from './support/postbox/sent-invitations.ts';

describe('invitation delivery', () => {
  test('with a delivery filler invite answers no token, the filler receives it once, and that token is accepted', async () => {
    sentInvitations.length = 0;
    const app = await bootMembers('memory', { delivery: true });
    onTestFinished(() => app.runtime.stop());
    // Bring-up through the filler too: the operator's answer carries no token either.
    const owner = await app
      .operator()
      .invoke('members.invitation.createOwner', { email: 'founder@example.com' });
    expect(owner.token).toBeUndefined();
    const ownerMessage = sentInvitations[0];
    expect(ownerMessage).toMatchObject({ email: 'founder@example.com', role: 'owner' });
    expect((await acceptAs(app, founder, ownerMessage?.token ?? '')).ok).toBe(true);

    const invited = await app
      .as(founder)
      .invoke('members.invitation.invite', { email: 'ada@example.com', role: 'member' });
    expect(invited.token).toBeUndefined();
    expect(sentInvitations).toHaveLength(2);
    const message = sentInvitations[1];
    expect(message).toMatchObject({ email: 'ada@example.com', role: 'member' });
    expect(message?.token).toMatch(/^kwi_/);
    expect(message?.expiresAt.epochMilliseconds).toBe(invited.expiresAt.epochMilliseconds);
    const accepted = await acceptAs(app, invitee, message?.token ?? '');
    expect(accepted.ok).toBe(true);
  });
});
