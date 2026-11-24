import { findPlaintext, type LoggedLine, recordingLogger } from '@keelwerk/testing';
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
  invitee,
  refusalOfAttempt,
} from './support/member-calls.ts';

const json = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint' ? member.toString() : member,
  );

describe.each(['memory', 'pglite'] as const)('members secrecy on %s', (kind: MembersStorage) => {
  async function boot(lines: LoggedLine[]): Promise<BootedMembers> {
    const app = await bootMembers(kind, { logger: recordingLogger(lines) });
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  test('the accept token never appears in a stored receipt (S-97), and a replay of invite answers conflict', async () => {
    const app = await boot([]);
    await bringUpOwner(app);
    const commandId = crypto.randomUUID();
    const input = { email: 'ada@example.com', role: 'member' } as const;
    const first = await app.as(founder).attempt('members.invitation.invite', input, { commandId });
    if (!first.ok) throw first.error;
    const { token, id } = first.value as { token: string; id: string };
    const secret = token.split('_')[2] ?? '';
    expect(secret).toHaveLength(52);
    const replay = await app.as(founder).attempt('members.invitation.invite', input, { commandId });
    expect(replay.ok ? undefined : replay.error.kind).toBe('conflict');
    expect(json(replay)).not.toContain(secret);
    const receipt = await app.receipt(commandId);
    expect(json(receipt)).toContain(id);
    expect(json(receipt)).not.toContain(secret);
    expect(json(receipt)).not.toContain(token);
  });

  test('no row, event, receipt, job or log line holds the address or the token secret in plain text, and no refusal names them', async () => {
    const lines: LoggedLine[] = [];
    const app = await boot(lines);
    await bringUpOwner(app);
    const address = 'plain.person@example.com';
    const commandId = crypto.randomUUID();
    const invited = await app
      .as(founder)
      .attempt('members.invitation.invite', { email: address, role: 'member' }, { commandId });
    if (!invited.ok) throw invited.error;
    const { token, id } = invited.value as { token: string; id: string };
    const secret = token.split('_')[2] ?? '';
    const refusals = [
      await app
        .as(founder)
        .attempt('members.invitation.invite', { email: address, role: 'viewer' }),
      await acceptAs(app, invitee, `${token}x`),
      await acceptAs(app, invitee, `kwi_${'a'.repeat(26)}_${secret}`),
    ];
    for (const refusal of refusals) expect(refusal.ok).toBe(false);
    const accepted = await acceptAs(app, invitee, token);
    expect(accepted.ok).toBe(true);
    const afterUse = await acceptAs(app, invitee, token);
    refusals.push(afterUse);
    // Let the expiry timer run, so its job leaves its traces too.
    await app.runtime.advanceTo(bootInstant.add({ hours: 7 * 24 + 1 }));
    const stored = await app.runtime.adapter.unit(
      app.runtime.namespace,
      app.scope,
      async (unit) => ({
        events: await unit.events.readAll(null, { limit: 1000 }),
        receipts: [await unit.receipts.get(commandId)],
      }),
    );
    expect(stored.events.events.length).toBeGreaterThan(0);
    const row = await app.row('invitation', id);
    expect(row?.email).toBe(address);
    for (const [name, value] of Object.entries({
      events: stored.events,
      receipts: stored.receipts,
      refusals,
      lines,
    })) {
      for (const marker of [address, secret, token]) {
        expect(json(value).toLowerCase(), `${name} holds ${marker}`).not.toContain(
          marker.toLowerCase(),
        );
      }
    }
    expect(lines.length).toBeGreaterThan(0);
    if (kind === 'pglite') {
      expect(findPlaintext(await app.dumpOf(), [address, 'plain.person', secret])).toEqual([]);
    }
    expect(refusalOfAttempt(refusals[0] ?? afterUse)?.kind).toBe('conflict');
  });
});
