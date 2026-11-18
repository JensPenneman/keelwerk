import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ada, grace, type Person } from './support/auth-calls.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';
import { delivered } from './support/mailbox/delivered.ts';
import { overlapGate } from './support/overlap-gate.ts';

const heidi: Person = { identifier: 'heidi@example.org', password: 'a long password of heidi' };

describe('reset deliveries on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let both: BootedBoth;

  beforeAll(async () => {
    postgres = await startPostgres();
    both = await bootBoth(
      'memory',
      {},
      { factory: postgresAdapter({ ownerUrl: postgres.adminUrl }), url: postgres.appUrl },
    );
    for (const person of [ada, grace, heidi]) {
      const done = await both.request('auth.signUp', person);
      if (!done.ok) throw done.error;
    }
    await both.settle();
    // The first secret issued in a scope creates the scope's decoy key under a lock that a second
    // delivery would wait for: one delivery first, so that the tests overlap on a scope that has it.
    await both.request('auth.requestPasswordReset', { identifier: heidi.identifier });
    await both.settle();
  }, 120_000);

  afterAll(async () => {
    await both?.runtime.stop();
    await postgres?.stop();
  });

  const linksOf = async (identifier: string) => {
    const credential = (await both.rows('auth.credential', { sealed: true })).find(
      (row) => row.identifier === identifier,
    );
    const now = both.clock.now();
    const tokens = await both.rows('auth.resetToken');
    return {
      credentialId: credential?.id,
      live: tokens.filter(
        (row) =>
          row.credentialId === credential?.id &&
          row.usedAt === undefined &&
          Temporal.Instant.compare(row.expiresAt as Temporal.Instant, now) > 0,
      ),
    };
  };

  test('two deliveries that run at the same moment each leave a live link for the same credential', async () => {
    delivered.length = 0;
    const gate = overlapGate(both.runtime.adapter);
    await both.request('auth.requestPasswordReset', { identifier: ada.identifier });
    await gate.arrived(1);
    // The first delivery is running, so the second request finds no pending timer of the key and
    // sets another one, which a second worker slot takes.
    await both.request('auth.requestPasswordReset', { identifier: ada.identifier });
    // The workers poll on the hand clock: moving it makes them look again for the second timer.
    for (let round = 0; round < 40; round += 1) {
      try {
        await gate.arrived(2, 250);
        break;
      } catch {
        both.clock.advance({ seconds: 2 });
      }
    }
    await gate.arrived(2, 1);
    gate.open();
    await both.settle();
    const { credentialId, live } = await linksOf(ada.identifier);
    expect(delivered).toHaveLength(2);
    expect(live).toHaveLength(2);
    expect(live.every((row) => row.credentialId === credentialId)).toBe(true);
  }, 60_000);

  test('a delivery that starts after another has finished retires the older link', async () => {
    delivered.length = 0;
    await both.request('auth.requestPasswordReset', { identifier: grace.identifier });
    await both.settle();
    both.clock.advance({ minutes: 1 });
    await both.request('auth.requestPasswordReset', { identifier: grace.identifier });
    await both.settle();
    const { live } = await linksOf(grace.identifier);
    expect(delivered).toHaveLength(2);
    expect(live).toHaveLength(1);
  }, 60_000);
});
