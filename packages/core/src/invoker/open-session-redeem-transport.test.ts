import { describe, expect, test } from 'vitest';
import { sessionOf } from '../../test/invoker/invoker-kit.ts';
import { ticketCarrier, worldOf } from '../../test/invoker/redeem-world.ts';

describe('the transport that redeems a reference', () => {
  test('a ticket redemption and the revalidation of its session name the transport of the carrier', async () => {
    const { invoker, transports } = worldOf();
    const session = sessionOf(await invoker.open({ ...ticketCarrier, transport: 'http' }));
    expect(transports).toEqual(['http']);
    sessionOf(await session.revalidate());
    expect(transports).toEqual(['http', 'http']);
  });
});
