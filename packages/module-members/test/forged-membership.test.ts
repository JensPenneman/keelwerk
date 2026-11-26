import { describe, expect, onTestFinished, test } from 'vitest';
import { bootMembers, type MembersStorage } from './support/boot-members.ts';
import { refusalOfAttempt, stranger } from './support/member-calls.ts';

describe.each(['memory', 'pglite'] as const)(
  'a forged membership on %s',
  (kind: MembersStorage) => {
    test('an enricher of another module that returns an admin membership of members reads no invitation', async () => {
      const app = await bootMembers(kind, { forged: true });
      onTestFinished(() => app.runtime.stop());
      const address = 'founder@example.com';
      const invited = await app.operator().attempt('members.invitation.createOwner', {
        email: address,
      });
      if (!invited.ok) throw invited.error;
      const read = await app.as(stranger).attempt('members.invitation.query', {});
      expect(refusalOfAttempt(read)).toMatchObject({ kind: 'internal', code: 'core.internal' });
      expect(JSON.stringify(read)).not.toContain(address);
      const members = await app.as(stranger).attempt('members.membership.query', {});
      expect(members.ok).toBe(false);
    });

    test('a resolver of another module that answers an admin membership of members reads no invitation', async () => {
      const app = await bootMembers(kind, { resolverForged: true });
      onTestFinished(() => app.runtime.stop());
      const address = 'founder@example.com';
      const invited = await app.operator().attempt('members.invitation.createOwner', {
        email: address,
      });
      if (!invited.ok) throw invited.error;
      const read = await app.as(stranger).attempt('members.invitation.query', {});
      expect(refusalOfAttempt(read)).toMatchObject({ kind: 'internal', code: 'core.internal' });
      expect(JSON.stringify(read)).not.toContain(address);
    });
  },
);
