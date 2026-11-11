import { describe, expect, test } from 'vitest';
import { failureOf, sessionOf } from '../../test/invoker/invoker-kit.ts';
import {
  referredUserOf,
  standing,
  ticketCarrier,
  worldOf,
} from '../../test/invoker/redeem-world.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import { errors } from '../errors/errors.ts';

describe('open with a redeemed credential', () => {
  test('a redemption opens the session as the principal its reference resolves to', async () => {
    const { invoker, rows } = worldOf();
    const session = sessionOf(await invoker.open(ticketCarrier));
    expect(session.principal).toMatchObject({ kind: 'user', subject: 'ada' });
    expect(rows.get('tk1')).toMatchObject({ version: 2 });
  });

  test('the session depends on the rows of that resolution', async () => {
    const { invoker } = worldOf();
    const session = sessionOf(await invoker.open(ticketCarrier));
    expect(session.dependsOn).toEqual([{ entity: 'doc.pass', id: 'p1' }]);
  });

  test('revalidate re-resolves the reference, not the spent ticket', async () => {
    const { invoker } = worldOf();
    const first = sessionOf(await invoker.open(ticketCarrier));
    const second = sessionOf(await first.revalidate());
    expect(second).not.toBe(first);
    expect(second.principal).toMatchObject({ kind: 'user', subject: 'ada' });
  });

  test('a revoked reference fails revalidate unauthenticated', async () => {
    const { invoker, revoked } = worldOf();
    const session = sessionOf(await invoker.open(ticketCarrier));
    revoked.add('ada');
    expect(failureOf(await session.revalidate()).kind).toBe('unauthenticated');
  });

  test('a redemption naming a kernel resolver or an entity of another module is internal', async () => {
    const kernel = worldOf({ resolver: 'core.operator', principalId: 'x' });
    expect(failureOf(await kernel.invoker.open(ticketCarrier)).kind).toBe('internal');
    const foreign = worldOf(standing, 'other.ticket');
    expect(failureOf(await foreign.invoker.open(ticketCarrier)).kind).toBe('internal');
  });

  test('the retained carrier holds no ticket', async () => {
    const { invoker, rows } = worldOf();
    const session = sessionOf(await invoker.open(ticketCarrier));
    // Revalidation succeeds although the ticket row is spent: it never presents the ticket again.
    expect(rows.get('tk1')?.usedAt).toBeDefined();
    expect((await session.revalidate()).ok).toBe(true);
    expect(errors.internal('x').kind).toBe('internal');
  });
});

describe('a ticket whose principal no longer resolves', () => {
  const same = {
    kind: 'unauthenticated',
    code: 'core.ticket_invalid',
    message: 'The stream ticket is not valid.',
  };

  test.each([
    ['unauthenticated', () => errors.unauthenticated('gone')],
    ['forbidden', () => errors.forbidden('no')],
    ['not_found', () => errors.not_found('missing')],
    ['rate_limited', () => errors.rate_limited('slow down')],
    ['not_implemented', () => errors.not_implemented('later')],
  ])('a fromRef that throws %s answers like a spent ticket', async (_kind, make) => {
    const { invoker, rows } = worldOf(standing, 'doc.ticket', [], [], () => make());
    expect(failureOf(await invoker.open(ticketCarrier))).toMatchObject(same);
    expect(rows.get('tk1')?.usedAt).toBeDefined();
  });

  test('a fromRef that answers nothing answers like a spent ticket', async () => {
    const { invoker, revoked } = worldOf();
    revoked.add('ada');
    expect(failureOf(await invoker.open(ticketCarrier))).toMatchObject(same);
  });

  test('an internal or unavailable error stays what it is', async () => {
    const internal = worldOf(standing, 'doc.ticket', [], [], () => errors.internal('broken'));
    expect(failureOf(await internal.invoker.open(ticketCarrier)).kind).toBe('internal');
    const down = worldOf(standing, 'doc.ticket', [], [], () => errors.unavailable('down'));
    expect(failureOf(await down.invoker.open(ticketCarrier)).kind).toBe('unavailable');
  });
});

describe('a spend-only ticket', () => {
  test('is spent and never opens a session, whatever it is bound to', async () => {
    const { invoker, rows, loaded } = worldOf();
    const failure = failureOf(
      await invoker.open({
        ...ticketCarrier,
        ticket: { value: 'good', endpoint: 'subscribe', action: 'other.sub', spendOnly: true },
      }),
    );
    expect(failure).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
    expect(rows.get('tk1')?.usedAt).toBeDefined();
    expect(loaded).toEqual([]);
  });
});

describe('a ticket that no resolver redeems', () => {
  /** An app whose other resolver authenticates from a header the host does not drop. */
  const byHeader: PrincipalResolver = {
    id: 'test.header',
    describe: () => ({ scheme: 'apiKey' }),
    // biome-ignore lint/correctness/useYield: the test resolver loads nothing
    *resolve(carrier) {
      return carrier.headers?.['x-key'] === undefined ? null : { principal: referredUserOf('bob') };
    },
  };

  test('a broken ticket is core.ticket_invalid, not anonymous', async () => {
    const { invoker } = worldOf();
    const failure = failureOf(
      await invoker.open({
        ...ticketCarrier,
        ticket: { value: 'broken', endpoint: 'subscribe', action: null },
      }),
    );
    expect(failure).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
  });

  test('a broken ticket beside another resolver’s credential never opens as that credential', async () => {
    const { invoker } = worldOf(standing, 'doc.ticket', [byHeader]);
    const failure = failureOf(
      await invoker.open({
        ...ticketCarrier,
        headers: { 'x-tenant': 't1', 'x-key': 'k' },
        ticket: { value: 'broken', endpoint: 'subscribe', action: null },
      }),
    );
    expect(failure).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
  });

  test('a good ticket decides alone: an earlier resolver that read a header does not answer first', async () => {
    const { invoker, rows } = worldOf(standing, 'doc.ticket', [], [byHeader]);
    const session = sessionOf(
      await invoker.open({ ...ticketCarrier, headers: { 'x-tenant': 't1', 'x-key': 'k' } }),
    );
    expect(session.principal).toMatchObject({ subject: 'ada' });
    expect(rows.get('tk1')?.usedAt).toBeDefined();
  });

  test('a good ticket still opens as its principal beside another resolver', async () => {
    const { invoker } = worldOf(standing, 'doc.ticket', [byHeader]);
    const session = sessionOf(await invoker.open(ticketCarrier));
    expect(session.principal).toMatchObject({ subject: 'ada' });
  });
});
