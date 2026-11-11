import { describe, expect, test } from 'vitest';
import { failureOf, sessionOf } from '../../test/invoker/invoker-kit.ts';
import { standing, ticketCarrier, worldOf } from '../../test/invoker/redeem-world.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import { errors } from '../errors/errors.ts';
import type { Carrier } from './carrier.ts';

describe('an earlier resolver that throws on its own credential', () => {
  /** An API-key resolver: an unknown key throws, as a revoked pass does. */
  function throwing(make: () => Error): PrincipalResolver {
    return {
      id: 'test.key',
      describe: () => ({ scheme: 'apiKey' }),
      // biome-ignore lint/correctness/useYield: the test resolver loads nothing
      *resolve(carrier) {
        if (carrier.headers?.['x-key'] !== undefined) throw make();
        return null;
      },
    };
  }
  const stale: Carrier = {
    ...ticketCarrier,
    headers: { 'x-tenant': 't1', 'x-key': 'revoked' },
  };

  test('does not stop a good ticket from being redeemed and spent', async () => {
    const { invoker, rows } = worldOf(
      standing,
      'doc.ticket',
      [],
      [throwing(() => errors.unauthenticated('The key is revoked.'))],
    );
    const session = sessionOf(await invoker.open(stale));
    expect(session.principal).toMatchObject({ subject: 'ada' });
    expect(rows.get('tk1')?.usedAt).toBeDefined();
  });

  test('does not stop a spend-only ticket from being spent', async () => {
    const { invoker, rows } = worldOf(
      standing,
      'doc.ticket',
      [],
      [throwing(() => errors.unauthenticated('The key is revoked.'))],
    );
    const failure = failureOf(
      await invoker.open({
        ...stale,
        ticket: { value: 'good', endpoint: 'subscribe', action: 'other.sub', spendOnly: true },
      }),
    );
    expect(failure).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
    expect(rows.get('tk1')?.usedAt).toBeDefined();
  });

  test('leaves a broken ticket core.ticket_invalid, not the key error', async () => {
    const { invoker } = worldOf(
      standing,
      'doc.ticket',
      [],
      [throwing(() => errors.unauthenticated('The key is revoked.'))],
    );
    const failure = failureOf(
      await invoker.open({
        ...stale,
        ticket: { value: 'broken', endpoint: 'subscribe', action: null },
      }),
    );
    expect(failure).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
  });

  test('a rate-limited key does not stop a good ticket, and a broken ticket is core.ticket_invalid', async () => {
    const limited = throwing(() => errors.rate_limited('Too many tries.'));
    const found = worldOf(standing, 'doc.ticket', [], [limited]);
    expect(sessionOf(await found.invoker.open(stale)).principal).toMatchObject({ subject: 'ada' });
    const lost = worldOf(standing, 'doc.ticket', [], [limited]);
    const failure = failureOf(
      await lost.invoker.open({
        ...stale,
        ticket: { value: 'broken', endpoint: 'subscribe', action: null },
      }),
    );
    expect(failure).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
  });

  test('an internal error stays when no resolver redeems, and yields to a redemption', async () => {
    const broken = throwing(() => errors.internal('The key store is broken.'));
    const lost = worldOf(standing, 'doc.ticket', [], [broken]);
    expect(
      failureOf(
        await lost.invoker.open({
          ...stale,
          ticket: { value: 'broken', endpoint: 'subscribe', action: null },
        }),
      ).kind,
    ).toBe('internal');
    const found = worldOf(standing, 'doc.ticket', [], [broken]);
    expect(sessionOf(await found.invoker.open(stale)).principal).toMatchObject({ subject: 'ada' });
  });

  test('outside a ticket the error still fails the open', async () => {
    const { invoker } = worldOf(
      standing,
      'doc.ticket',
      [],
      [throwing(() => errors.unauthenticated('The key is revoked.'))],
    );
    const { ticket: _ticket, ...plain } = stale;
    expect(failureOf(await invoker.open(plain)).kind).toBe('unauthenticated');
  });
});
