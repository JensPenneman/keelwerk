import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { testOperator } from '@keelwerk/testing';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { bootOwnerApp, type EnrolledOwner, enrolOwner } from './support/boot-owner-app.ts';
import { parkUnits, watchBlocked } from './support/park-units.ts';
import { watchStore } from './support/watch-store.ts';

const operator = testOperator();

// Two write units must be open at once, which only PostgreSQL gives. A key revoke is held right
// after it rewrote the key row; the deactivation then runs into it, and the database's own list of
// who waits for whom says whether it was held back. No case reads a clock.
let postgres: Awaited<ReturnType<typeof startPostgres>>;
let app: Awaited<ReturnType<typeof bootOwnerApp>>;
let owner: EnrolledOwner;

beforeAll(async () => {
  postgres = await startPostgres();
  app = await bootOwnerApp('memory', {
    factory: postgresAdapter({ ownerUrl: postgres.adminUrl }),
    url: postgres.appUrl,
  });
  // Jobs that would rewrite a row of the case wait: the login's record on the profile, and the revocations (the key's among them would wait for the key row).
  const watch = watchStore(app.runtime.adapter);
  for (const action of ['auth.recordLogin', 'auth.revokeSubject', 'api-keys.revokeSubject']) {
    watch.deferred.add(action);
  }
  owner = await enrolOwner(app);
}, 120_000);

afterAll(async () => {
  await app?.runtime.stop();
  await postgres?.stop();
});

test('a key revoke holding a key row neither delays nor repeats the deactivation', {
  timeout: 60_000,
}, async () => {
  const profileId = await app.profileId();
  const units = parkUnits(app.runtime.adapter);
  const parked = units.parkOn('api-keys.key');
  const revoke = app.request(
    'api-keys.key.revoke',
    { id: owner.keyId },
    owner.session.sessionToken,
  );
  await parked.arrived;
  units.forget();
  const watch = watchBlocked(postgres);
  const deactivation = app
    .client(operator)
    .attempt('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
  const first = await Promise.race([deactivation.then(() => 'finished' as const), watch.blocked]);
  watch.stop();
  parked.release();
  const revoked = await revoke;
  const done = await deactivation;
  expect(first).toBe('finished');
  expect(revoked.ok).toBe(true);
  expect(done.ok ? undefined : done.error).toBeUndefined();
  expect(units.rewrites.filter((ref) => ref === 'accounts.profile')).toHaveLength(1);
});
