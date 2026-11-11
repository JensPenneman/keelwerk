import type { KeelwerkError, PrincipalResolver } from '@keelwerk/core';
import { dumpDatabase, findPlaintext, testPrincipal } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import { issueTicket } from '../../src/tickets/issue-ticket.ts';
import { ticketResolverFill } from '../../src/tickets/ticket-resolver-fill.ts';
import { adaPrincipal as ada, startLiveApp } from '../support/live-app-kit.ts';
import { notices } from '../support/notice-module.ts';
import { printedJson } from '../support/printed-json.ts';

vi.setConfig({ testTimeout: 60_000 });
const now = Temporal.Instant.from('2026-11-11T12:00:00Z');
const clock = { now: () => now };

/** A decide context at the deployment level: any use of it but the scope is a failure. */
function deploymentContext() {
  return new Proxy(
    {
      scope: { level: 'deployment' },
      principal: { ref: { resolver: 'test.principal', principalId: 'ada' } },
    },
    {
      get: (target, name) => {
        if (name in target) return target[name as keyof typeof target];
        throw new Error(`decide used ctx.${String(name)} at the deployment level`);
      },
    },
  );
}

describe.each(['memory', 'pglite'] as const)('live.ticket on %s', (adapter) => {
  test('answers a kwst ticket and expiresAt 60 s later', async () => {
    const kit = await startLiveApp(adapter, undefined, { clock });
    try {
      const answer = await kit.call<{ ticket: string; expiresAt: Temporal.Instant }>(
        kit.acme,
        ada,
        'live.ticket',
        {},
      );
      expect(answer.ticket).toMatch(/^kwst_[a-z2-7]{26}_[a-z2-7]{26,205}$/);
      expect(String(answer.expiresAt)).toBe(String(now.add({ seconds: 60 })));
    } finally {
      await kit.stop();
    }
  });

  test('the row holds the verifier, never the ticket, and the principal reference', async () => {
    const kit = await startLiveApp(adapter, undefined, { clock });
    try {
      const answer = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {
        action: 'board.cards',
      });
      const secret = answer.ticket.split('_')[2] ?? '';
      const [row] = await kit.tickets(kit.acme);
      expect(row).toMatchObject({
        principalResolver: 'test.principal',
        principalId: 'ada',
        action: 'board.cards',
        endpoint: 'subscribe',
      });
      expect(printedJson(row)).not.toContain(secret);
      expect(row?.verifier).toBeDefined();
      expect(row?.usedAt).toBeUndefined();
    } finally {
      await kit.stop();
    }
  });

  test('the receipt keeps no ticket', async () => {
    const kit = await startLiveApp(adapter, undefined, { clock });
    try {
      const commandId = crypto.randomUUID();
      const outcome = await kit.runtime.invoker.invoke<unknown, { ticket: string }>({
        action: 'live.ticket',
        input: {},
        carrier: {
          transport: 'test',
          headers: { 'x-tenant': kit.acme.id, 'x-test-principal': JSON.stringify(ada) },
        },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        commandId,
      });
      if (!outcome.ok) throw outcome.error;
      const secret = outcome.value.ticket.split('_')[2] ?? '';
      const receipt = await kit.runtime.adapter.unit(
        kit.runtime.namespace,
        { level: 'tenant', backendId: kit.runtime.backendId, tenantId: kit.acme.id },
        (unit) => unit.receipts.get(commandId),
      );
      expect(receipt).toMatchObject({ action: 'live.ticket', status: 'completed' });
      expect(printedJson(receipt)).not.toContain(secret);
    } finally {
      await kit.stop();
    }
  });

  test('anonymous is unauthenticated', async () => {
    const kit = await startLiveApp(adapter, undefined, { clock });
    try {
      const outcome = await kit.attempt(
        {
          transport: 'test',
          headers: {
            'x-tenant': kit.acme.id,
            'x-test-principal': JSON.stringify(testPrincipal(null)),
          },
        },
        'live.ticket',
        {},
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.error?.kind).toBe('unauthenticated');
    } finally {
      await kit.stop();
    }
  });
});

describe('a dump of the whole database', () => {
  test('holds no ticket and no secret of one, whether it is unspent or spent', async () => {
    const kit = await startLiveApp('pglite', undefined, { clock });
    try {
      const unspent = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {
        action: 'board.cards',
      });
      const spent = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {
        action: 'board.cards',
      });
      await kit.open(kit.ticket(kit.acme, spent.ticket, { action: 'board.cards' }));
      const owner = kit.runtime.adapter;
      if (!('asOwner' in owner) || typeof owner.asOwner !== 'function') {
        throw new Error('the PGlite adapter has no owner connection');
      }
      const asOwner = owner.asOwner.bind(owner) as (
        fn: (database: {
          query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
        }) => Promise<string>,
      ) => Promise<string>;
      const dump = await asOwner((database) =>
        dumpDatabase(async (sql) => (await database.query(sql)).rows),
      );
      const secrets = [unspent.ticket, spent.ticket].flatMap((ticket) => [
        ticket,
        ticket.split('_')[2] ?? '',
      ]);
      expect(secrets.every((secret) => secret.length > 20)).toBe(true);
      expect(findPlaintext(dump, secrets)).toEqual([]);
    } finally {
      await kit.stop();
    }
  });
});

describe.each(['memory', 'pglite'] as const)('tickets at the backend level on %s', (adapter) => {
  test('a backend session issues a ticket and opens a backend subscription with it', async () => {
    const kit = await startLiveApp(adapter, undefined, { clock, extra: [notices] });
    try {
      const answer = await kit.attempt(kit.backendCarrier(ada), 'live.ticket', {
        action: 'notices.feed',
      });
      expect(answer.error).toBeUndefined();
      const { ticket } = answer.value as { ticket: string };
      const session = await kit.open(kit.backendTicket(ticket, { action: 'notices.feed' }));
      expect(session.scope).toEqual({ level: 'backend', backendId: kit.runtime.backendId });
      expect(session.principal).toMatchObject({ kind: 'user', subject: 'ada' });
      const followed = kit.follow(kit.backendTicket(ticket, { action: 'notices.feed' }), {
        session,
        action: 'notices.feed',
      });
      try {
        await followed.until((frames) =>
          frames.some((frame) => 'control' in frame && frame.control === 'head'),
        );
      } finally {
        await followed.stop();
      }
      expect(await kit.backendTickets()).toHaveLength(1);
      expect(await kit.tickets(kit.acme)).toHaveLength(0);
    } finally {
      await kit.stop();
    }
  });

  test('a backend ticket is core.ticket_invalid on a tenant of that backend, and a tenant ticket on the backend', async () => {
    const kit = await startLiveApp(adapter, undefined, { clock, extra: [notices] });
    try {
      const backend = (await kit.attempt(kit.backendCarrier(ada), 'live.ticket', {})).value as {
        ticket: string;
      };
      const tenant = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {});
      await expect(kit.open(kit.ticket(kit.acme, backend.ticket))).rejects.toMatchObject({
        kind: 'unauthenticated',
        code: 'core.ticket_invalid',
      });
      await expect(kit.open(kit.backendTicket(tenant.ticket))).rejects.toMatchObject({
        kind: 'unauthenticated',
        code: 'core.ticket_invalid',
      });
      // Neither refusal spent a ticket: each still opens where it was issued.
      expect((await kit.open(kit.backendTicket(backend.ticket))).scope.level).toBe('backend');
      expect((await kit.open(kit.ticket(kit.acme, tenant.ticket))).scope.level).toBe('tenant');
    } finally {
      await kit.stop();
    }
  });

  test('a ticket 59.999 s old opens and one exactly 60 s old is core.ticket_invalid', async () => {
    let at = now;
    const kit = await startLiveApp(adapter, undefined, { clock: { now: () => at } });
    try {
      const young = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {});
      const old = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {});
      at = now.add({ milliseconds: 59_999 });
      expect((await kit.open(kit.ticket(kit.acme, young.ticket))).principal).toMatchObject({
        subject: 'ada',
      });
      at = now.add({ seconds: 60 });
      await expect(kit.open(kit.ticket(kit.acme, old.ticket))).rejects.toMatchObject({
        code: 'core.ticket_invalid',
      });
    } finally {
      await kit.stop();
    }
  });

  test('a ticket whose principal no longer resolves answers what a spent, expired or unknown ticket answers', async () => {
    let at = now;
    const kit = await startLiveApp(adapter, undefined, { clock: { now: () => at } });
    try {
      const answers: unknown[] = [];
      const note = async (carrier: ReturnType<typeof kit.ticket>) => {
        const error = await kit.open(carrier).then(
          () => undefined,
          (failure: KeelwerkError) => failure,
        );
        answers.push({ kind: error?.kind, code: error?.code, message: error?.message });
      };
      const spent = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {});
      await kit.open(kit.ticket(kit.acme, spent.ticket));
      await note(kit.ticket(kit.acme, spent.ticket));
      await note(kit.ticket(kit.acme, `kwst_${'a'.repeat(26)}_${'b'.repeat(26)}`));
      const revoked = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {});
      kit.runtime.revoke('ada');
      await note(kit.ticket(kit.acme, revoked.ticket));
      const expired = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {});
      at = now.add({ seconds: 60 });
      await note(kit.ticket(kit.acme, expired.ticket));
      expect(answers).toHaveLength(4);
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
      expect(answers[3]).toEqual(answers[0]);
      expect(answers[0]).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
      expect(JSON.stringify(answers)).not.toMatch(/job/i);
    } finally {
      await kit.stop();
    }
  });

  test('a stream a ticket opened fails closed when its principal is revoked, and says nothing of a job', async () => {
    const kit = await startLiveApp(adapter, undefined, { clock });
    try {
      const issued = await kit.call<{ ticket: string }>(kit.acme, ada, 'live.ticket', {});
      const session = await kit.open(kit.ticket(kit.acme, issued.ticket));
      kit.runtime.revoke('ada');
      const outcome = await session.revalidate();
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error).toMatchObject({ kind: 'unauthenticated' });
      expect(outcome.error.message).not.toMatch(/job/i);
    } finally {
      await kit.stop();
    }
  });
});

describe('a ticket at the deployment level', () => {
  test('live.ticket is unsupported and writes no row', async () => {
    const { decide } = issueTicket.spec as unknown as {
      decide(input: unknown, ctx: unknown): Iterator<unknown>;
    };
    // The generator throws before it yields: no id, no secret, no write.
    expect(() => decide({}, deploymentContext()).next()).toThrow(
      expect.objectContaining({ kind: 'unsupported' }),
    );
  });

  test('a ticket presented there is core.ticket_invalid without a read', async () => {
    const [resolver] = (ticketResolverFill.factory as (own: unknown) => PrincipalResolver[])(
      new Proxy(
        {},
        {
          get: () => {
            throw new Error('the resolver read at the deployment level');
          },
        },
      ),
    );
    const resolving = resolver?.resolve(
      { transport: 'test', ticket: { value: 'kwst_x_y', endpoint: 'subscribe', action: null } },
      { scope: { level: 'deployment' }, clock } as never,
    );
    expect(() => resolving?.next()).toThrow(
      expect.objectContaining({ code: 'core.ticket_invalid' }),
    );
  });
});
