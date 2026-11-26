import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { testOperator } from '@keelwerk/testing';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ada, asBearer, grace, signIn } from './support/auth-calls.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';
import { holdJobs } from './support/hold-jobs.ts';
import { type ParkedUnits, parkUnits, watchBlocked } from './support/park-units.ts';

const operator = testOperator();

// Two write units must be open at once, which only PostgreSQL gives (one connection per unit and row
// locks). A unit is held right after it rewrote a row; the deactivation then runs into it, and the
// database's own list of who waits for whom says whether it was held back. No case reads a clock.
describe('what the deactivating unit waits for, on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let both: BootedBoth;
  let units: ParkedUnits;

  const profileOf = async (identifier: string): Promise<string> => {
    const rows = await both.rows('accounts.profile', { sealed: true });
    return String(rows.find((row) => row.email === identifier)?.id);
  };
  const deactivate = (id: string) =>
    both
      .client(operator)
      .attempt('accounts.profile.deactivate', { id: id as never, reason: 'left' });
  const profileRewrites = () => units.rewrites.filter((ref) => ref === 'accounts.profile').length;

  beforeAll(async () => {
    postgres = await startPostgres();
    both = await bootBoth(
      'memory',
      { auth: { identifierFailedAttempts: 1000 } },
      { factory: postgresAdapter({ ownerUrl: postgres.adminUrl }), url: postgres.appUrl },
    );
    for (const person of [ada, grace]) {
      const done = await both.request('auth.signUp', person);
      if (!done.ok) throw done.error;
    }
    await both.settle();
    units = parkUnits(both.runtime.adapter);
  }, 120_000);

  afterAll(async () => {
    await both?.runtime.stop();
    await postgres?.stop();
  });

  test('a login holding the credential row neither delays nor repeats the deactivation', {
    timeout: 60_000,
  }, async () => {
    const id = await profileOf(grace.identifier);
    // The revocation job would wait for the credential row too: it stays queued until the login is done.
    const held = holdJobs(both.runtime.adapter);
    const parked = units.parkOn('auth.credential');
    const login = both.request('auth.login', grace);
    await parked.arrived;
    units.forget();
    const watch = watchBlocked(postgres);
    const deactivation = deactivate(id);
    const first = await Promise.race([deactivation.then(() => 'finished' as const), watch.blocked]);
    watch.stop();
    parked.release();
    const loggedIn = await login;
    const done = await deactivation;
    expect(first).toBe('finished');
    expect(done.ok ? undefined : done.error).toBeUndefined();
    expect(profileRewrites()).toBe(1);
    // The login committed after the deactivation: its session is refused, and the job revokes the rest.
    expect(loggedIn.ok).toBe(true);
    const { sessionToken } = (loggedIn.ok ? loggedIn.value : {}) as { sessionToken: string };
    const refused = await both.request('auth.whoami', {}, { headers: asBearer(sessionToken) });
    expect(refused.ok ? undefined : refused.error.kind).toBe('unauthenticated');
    held.release();
    await both.settle();
    const credentials = (await both.rows('auth.credential')).filter((row) => row.profileId === id);
    expect(credentials).toHaveLength(1);
    expect(credentials.every((row) => row.revokedAt !== undefined)).toBe(true);
  });

  test('a profile edit by its own user holding the profile row delays the deactivation and never repeats it', {
    timeout: 60_000,
  }, async () => {
    const session = await signIn(both);
    await both.settle();
    const id = await profileOf(ada.identifier);
    const parked = units.parkOn('accounts.profile');
    const edit = both.request(
      'accounts.profile.update',
      { id, patch: { displayName: 'Ada L.' } },
      { headers: asBearer(session.sessionToken) },
    );
    await parked.arrived;
    units.forget();
    const watch = watchBlocked(postgres);
    const deactivation = deactivate(id);
    const first = await Promise.race([deactivation.then(() => 'finished' as const), watch.blocked]);
    watch.stop();
    parked.release();
    const edited = await edit;
    const done = await deactivation;
    expect(first).toBe('blocked');
    expect(edited.ok).toBe(true);
    expect(done.ok ? undefined : done.error).toBeUndefined();
    expect(profileRewrites()).toBe(1);
  });
});
