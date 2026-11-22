import { postgresAdapter } from '@keelwerk/adapter-postgres';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import type { RestartablePostgres } from '../../src/postgres/index.ts';
import { startPostgres } from '../../src/postgres/index.ts';
import { gate } from './support/job-spy.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, seededAt } from './support/ticker-kit.ts';

let postgres: RestartablePostgres | undefined;
let kit: TickerKit | undefined;
/**
 * True from `stopServer` to the `startServer` after it: `stop` of the container needs the server.
 */
let serverDown = false;
const lines: LoggedLine[] = [];

beforeAll(async () => {
  postgres = await startPostgres({ restartable: true });
  kit = await bootTicker({
    logger: recordingLogger(lines),
    external: {
      factory: postgresAdapter({ ownerUrl: postgres.adminUrl, applicationName: 'restart' }),
      url: postgres.appUrl,
    },
  });
}, 180_000);

afterAll(async () => {
  if (serverDown) await postgres?.startServer();
  await kit?.stop();
  await postgres?.stop();
});

/**
 * Resolves once `condition` holds; with a grace of 60 s, and a look that started after it decides.
 */
async function until(label: string, condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const looked = Date.now();
    if (await condition()) return;
    if (looked > deadline) throw new Error(`${label} did not happen`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * The backends that listen on `kw_jobs` for the app, by pid: what `pg_stat_activity` shows of them
 * once their `LISTEN` has ended (`idle`): while it runs, its notifications are not yet delivered.
 */
async function jobSessions(): Promise<readonly number[]> {
  const client = new pg.Client({ connectionString: postgres?.adminUrl });
  await client.connect();
  try {
    const found = await client.query<{ pid: number }>(
      `select pid from pg_stat_activity
       where application_name = $1 and query = $2 and state = 'idle' order by pid`,
      ['restart-listen', 'listen kw_jobs'],
    );
    return found.rows.map((row) => row.pid);
  } finally {
    await client.end();
  }
}

test('an app on PostgreSQL keeps its process through a restart of the server: commands fail with core.unavailable meanwhile, and afterwards the reopened session wakes the workers, a lease that passed is reclaimed and runs once, a schedule fires, and commands and notifications work', {
  timeout: 240_000,
}, async () => {
  if (kit === undefined || postgres === undefined) throw new Error('the test did not start');
  const { spy } = kit;
  const beatRows = async () => (await kit?.rows('backend', 'ticker.beat')) ?? [];
  const beats = async (): Promise<readonly unknown[]> => (await beatRows()).map((row) => row.at);
  const heldBeats = async (): Promise<number> => (await beats()).filter((at) => at === 'H').length;
  const renewalFailures = (): number =>
    lines.filter((line) => line.message.startsWith('a lease renewal failed')).length;
  const scheduleFailures = (): number =>
    lines.filter((line) => line.message === 'a schedule pass failed').length;
  const call = (action: string, input: unknown) => kit?.call('acme', action, input);
  const escalate = (at: string) => call('ticker.escalate', { at });
  expect((await escalate('before'))?.ok).toBe(true);
  await until('the first job', async () => (await beats()).includes('before'));

  // H: taken, and held at the principal resolution of its run, before any connection opens for it.
  spy.refuseTake = () => true;
  expect((await escalate('H'))?.ok).toBe(true);
  const held = gate(1);
  spy.hold = held;
  const takesBeforeH = spy.takes.length;
  spy.refuseTake = undefined;
  const settling: Promise<unknown>[] = [kit.runtime.drainJobs()];
  for (const each of settling) each.catch(() => undefined);
  await held.entered;
  delete spy.hold;
  const heldJob = spy.takes.slice(takesBeforeH).flatMap((take) => take.jobs)[0];
  if (heldJob === undefined) throw new Error('no take returned the held job');
  expect(heldJob.attempt.attempt).toBe(1);

  // J1: enqueued and committed before the server goes away, its wake-up refused: the fetchers' take
  // answers nothing. What runs it after the restart is a sweep, and no one of the three that can
  // start one is made certain here: the wake the reopened sessions send, a wake that reached a
  // fetcher before the outage and that the outage left pending in a sweep that failed, or the
  // paced poll, once the clock has passed its pause (the record of 21 Nov 2026 showed each of the
  // last two on its own). The case asserts that J1 runs without a command of the test and without
  // a sweep the test starts. The reopened session's wake alone is pinned where nothing else can
  // run: listen-loss.postgres.test.ts (the wake that names no queue, after the new session) and
  // listen-connection-order.test.ts (it comes after `LISTEN`, never before).
  spy.refuseTake = () => true;
  expect((await escalate('J1'))?.ok).toBe(true);
  const sessionsBefore = await jobSessions();
  // The control placement and the app's placement each hold one.
  expect(sessionsBefore).toHaveLength(2);
  await postgres.stopServer();
  serverDown = true;
  spy.refuseTake = undefined;
  const down = await call('ticker.recordTick', { schedule: 'down', at: 'down' });
  expect(down?.ok).toBe(false);
  expect(down?.ok === false && down.error.code).toBe('core.unavailable');

  // The clock moves past H's heartbeat while the server is away: its renewal fails, and the pause
  // of the policy is counted on the clock that stands still, so no second try is made.
  settling.push(kit.runtime.advanceTo(seededAt.add({ seconds: 11 })));
  await until('the first failed renewal', async () => renewalFailures() === 1);
  // The clock then passes H's lease (30 s), the retry of its renewal and the next schedule boundary
  // (five minutes): the renewal fails again, and is not asked in between.
  settling.push(kit.runtime.advanceTo(seededAt.add({ minutes: 5 })));
  await until('the second failed renewal', async () => renewalFailures() === 2);
  // The schedule ticker passes on its own timer, whatever the clock says: while the server is away
  // its pass fails.
  await until('a failed schedule pass', async () => scheduleFailures() >= 1);

  const takesBeforeStart = spy.takes.length;
  await postgres.startServer();
  serverDown = false;
  // Each reopened kw_jobs session is a new backend, shown once its `LISTEN` has ended. The test
  // sends no command and starts no sweep: J1 is taken and H reclaimed by what the app does itself.
  await until(
    'the new kw_jobs sessions',
    async () =>
      (await jobSessions()).filter((pid) => !sessionsBefore.includes(pid)).length ===
      sessionsBefore.length,
  );
  await until('J1', async () => (await beats()).includes('J1'));
  await until('the second attempt of H', async () => (await heldBeats()) === 1);
  const afterStart = spy.takes.slice(takesBeforeStart).flatMap((take) => take.jobs);
  expect(afterStart.map(({ id, attempt }) => `${String(id)}/${attempt.attempt}`)).toContain(
    `${String(heldJob.id)}/2`,
  );

  // The first attempt of H is let go: the store refuses its completion, and its run writes nothing.
  held.release();
  await until('the refused completion of the first attempt', async () =>
    spy.completions.some(
      (done) => done.attempt.jobId === heldJob.id && done.attempt.attempt === 1 && !done.granted,
    ),
  );
  expect(
    spy.completions
      .filter((done) => done.attempt.jobId === heldJob.id && done.granted)
      .map((done) => done.attempt.attempt),
  ).toEqual([2]);
  expect(await heldBeats()).toBe(1);

  // J2 is the first command of the test after the restart. The app's own units can send before it
  // (in one record, a wake for every queue and a wake of the events channel did); the order cannot
  // matter. The connection the restart ended was dropped when the driver reported it (asserted
  // below), so the first send after the restart opens a new one, and the sessions listen by now
  // (shown above). A job committed before they listen is J1's case: its NOTIFY reaches nobody,
  // Postgres keeps none, and only a sweep that the reopening of a session or the poll causes finds
  // it. J2 runs through its own notification, or through the wake of a session whose reopening has
  // not been delivered yet: both are the app's, and neither is the poll.
  expect(lines.some((line) => line.message === 'postgres notifier: the connection failed')).toBe(
    true,
  );
  expect((await escalate('J2'))?.ok).toBe(true);
  await until('J2', async () => (await beats()).includes('J2'));

  // The schedule that came due at five minutes while the server was away fires once, whichever pass
  // runs it: what the case counts is the rows, one of the backend schedule and one of each
  // tenant's.
  settling.push(kit.runtime.advanceTo(seededAt.add({ minutes: 6 })));
  await Promise.all(settling);
  const backend = (await beatRows()).filter((row) => row.source === 'everyBackend');
  expect(backend.map((row) => row.at)).toEqual(['2026-01-01T00:05:00Z']);
  for (const tenant of ['acme', 'globex'] as const) {
    const ticks = (await kit.rows(tenant, 'ticker.tick')).filter(
      (row) => row.schedule === 'everyTenant',
    );
    expect(ticks).toHaveLength(1);
  }
  // H ran once and its renewal was asked twice, once for each reading of the clock past its pause:
  // the clock stood still in between, so a loop that did not wait for its pause would have asked
  // on every tick.
  expect(await heldBeats()).toBe(1);
  expect(renewalFailures()).toBe(2);
  // What the loops logged while the server was away says the one named error and nothing of the
  // driver.
  const codes = lines
    .filter((line) => line.level === 'error')
    .map((line) => (line.fields.cause as { code?: string } | undefined)?.code);
  expect(codes.length).toBeGreaterThan(0);
  expect(new Set(codes)).toEqual(new Set(['core.unavailable']));
});
