import type { KeelwerkError } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import type { LiveAppKit } from '../support/live-app-kit.ts';
import { adaPrincipal as ada, startLiveApp } from '../support/live-app-kit.ts';

vi.setConfig({ testTimeout: 60_000 });

async function refusal(work: Promise<unknown>): Promise<KeelwerkError> {
  try {
    await work;
  } catch (error) {
    return error as KeelwerkError;
  }
  throw new Error('expected the ticket to be refused');
}

async function issue(kit: LiveAppKit, action?: string): Promise<string> {
  const answer = await kit.call<{ ticket: string }>(
    kit.acme,
    ada,
    'live.ticket',
    action === undefined ? {} : { action },
  );
  return answer.ticket;
}

describe.each(['memory', 'pglite'] as const)('the ticket resolver on %s', (adapter) => {
  test('opens once', async () => {
    const kit = await startLiveApp(adapter);
    try {
      const ticket = await issue(kit, 'board.cards');
      const session = await kit.open(kit.ticket(kit.acme, ticket, { action: 'board.cards' }));
      expect(session.principal).toMatchObject({ kind: 'user', subject: 'ada' });
      const [row] = await kit.tickets(kit.acme);
      expect(row?.usedAt).toBeDefined();
      expect(row?.version).toBe(2);
      const again = await refusal(
        kit.open(kit.ticket(kit.acme, ticket, { action: 'board.cards' })),
      );
      expect(again).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
    } finally {
      await kit.stop();
    }
  });

  test('two requests that present one ticket at once open one session and one is core.ticket_invalid', async () => {
    const kit = await startLiveApp(adapter);
    try {
      const ticket = await issue(kit, 'board.cards');
      const present = () => kit.open(kit.ticket(kit.acme, ticket, { action: 'board.cards' }));
      const outcomes = await Promise.allSettled([present(), present()]);
      const opened = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(opened).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.reason).toMatchObject({
        kind: 'unauthenticated',
        code: 'core.ticket_invalid',
      });
      const [row] = await kit.tickets(kit.acme);
      expect(row?.version).toBe(2);
    } finally {
      await kit.stop();
    }
  });

  test('expired (61 s), forged secret, foreign prefix, other endpoint and other action are core.ticket_invalid', async () => {
    const kit = await startLiveApp(adapter);
    try {
      const old = await issue(kit);
      const forged = await issue(kit);
      const [prefix, publicId, secret] = forged.split('_');
      const flipped = `${secret?.startsWith('a') ? 'b' : 'a'}${secret?.slice(1)}`;
      const foreign = (await issue(kit)).replace(/^kwst_/, 'pss_');
      const bound = await issue(kit, 'board.cards');
      const other = await issue(kit);
      const wrongs: [string, ReturnType<LiveAppKit['ticket']>][] = [
        ['forged', kit.ticket(kit.acme, `${prefix}_${publicId}_${flipped}`)],
        ['foreign prefix', kit.ticket(kit.acme, foreign)],
        ['other action', kit.ticket(kit.acme, bound, { action: 'board.other' })],
        ['no action', kit.ticket(kit.acme, bound, { action: null })],
        ['not a ticket', kit.ticket(kit.acme, 'garbage')],
      ];
      for (const [name, carrier] of wrongs) {
        const error = await refusal(kit.open(carrier));
        expect(error, name).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
      }
      // None of the refusals spent a ticket.
      expect((await kit.tickets(kit.acme)).every((row) => row.usedAt === undefined)).toBe(true);
      await kit.runtime.advanceTo(Temporal.Now.instant().add({ seconds: 61 }));
      for (const value of [old, other]) {
        const error = await refusal(kit.open(kit.ticket(kit.acme, value)));
        expect(error).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
      }
    } finally {
      await kit.stop();
    }
  });

  test('a ticket of another tenant is core.ticket_invalid', async () => {
    const kit = await startLiveApp(adapter);
    try {
      const ticket = await issue(kit);
      const error = await refusal(kit.open(kit.ticket(kit.globex, ticket)));
      expect(error).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
    } finally {
      await kit.stop();
    }
  });

  test('the verifier presented as a ticket opens nothing', async () => {
    const kit = await startLiveApp(adapter);
    try {
      await issue(kit);
      const [row] = await kit.tickets(kit.acme);
      const verifier = String(row?.verifier);
      const error = await refusal(kit.open(kit.ticket(kit.acme, verifier)));
      expect(error).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
      const publicId = String(row?.publicId);
      const guessed = await refusal(kit.open(kit.ticket(kit.acme, `kwst_${publicId}_${verifier}`)));
      expect(guessed.code).toBe('core.ticket_invalid');
    } finally {
      await kit.stop();
    }
  });
});
