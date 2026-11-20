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
} from './support/member-calls.ts';

const invalid = 'members.invitation_invalid';

describe.each(['memory', 'pglite'] as const)('invitation expiry on %s', (kind: MembersStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedMembers> {
    const app = await bootMembers(kind);
    onTestFinished(() => app.runtime.stop());
    await bringUpOwner(app);
    return app;
  }

  test('accept is refused at exactly the expiry and accepted one tick before', {
    timeout,
  }, async () => {
    const app = await boot();
    const late = await inviteAs(app, founder, { email: 'late@example.com', role: 'member' });
    const early = await inviteAs(app, founder, { email: 'early@example.com', role: 'viewer' });
    // The timers fire at the expiry: stay one tick before it, then reach it.
    await app.runtime.advanceTo(early.expiresAt.subtract({ nanoseconds: 1 }));
    expect((await acceptAs(app, invitee, early.token ?? '')).ok).toBe(true);
    await app.runtime.advanceTo(late.expiresAt);
    expect(refusalOfAttempt(await acceptAs(app, founder, late.token ?? ''))?.code).toBe(invalid);
  });

  test('a timer that decides before the expiry is set again and the invitation still ends', {
    timeout,
  }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    // The row's expiry is a millisecond after the timer's: the node that decides runs behind the one that fired it.
    const lateExpiry = invited.expiresAt.add({ milliseconds: 1 });
    await app.plant('invitation', invited.id, { expiresAt: lateExpiry });
    await app.runtime.advanceTo(invited.expiresAt);
    expect((await app.row('invitation', invited.id))?.status).toBe('pending');
    await app.runtime.advanceTo(lateExpiry);
    expect((await app.row('invitation', invited.id))?.status).toBe('expired');
  });

  test('the first expiry of a run is the timer after the whole lifetime', { timeout }, async () => {
    const app = await boot();
    const invited = await inviteAs(app, founder, { email: 'ada@example.com', role: 'member' });
    expect(invited.expiresAt.epochMilliseconds - bootInstant.epochMilliseconds).toBe(
      7 * 24 * 3_600_000,
    );
    await app.runtime.advanceTo(invited.expiresAt.subtract({ minutes: 1 }));
    expect((await app.row('invitation', invited.id))?.status).toBe('pending');
    await app.runtime.advanceTo(invited.expiresAt);
    expect((await app.row('invitation', invited.id))?.status).toBe('expired');
  });
});
