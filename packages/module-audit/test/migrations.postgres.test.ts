import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type BootedAudit, bootAudit, withAccountsApp } from './support/boot-audit.ts';

describe('audit on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let app: BootedAudit<typeof withAccountsApp>;

  beforeAll(async () => {
    postgres = await startPostgres({ checkDeadlocks: true });
    app = await bootAudit(withAccountsApp, 'memory', {
      factory: postgresAdapter({ ownerUrl: postgres.adminUrl }),
      url: postgres.appUrl,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.runtime.stop();
    await postgres?.stop();
  });

  test('on PostgreSQL the migration applies, a login leaves an entry, and the audit table holds no plaintext address or user agent', async () => {
    const person = { identifier: 'ada@example.org', password: 'correct horse battery staple' };
    const signedUp = await app.request('auth.signUp', person);
    expect(signedUp.ok).toBe(true);
    const login = await app.request('auth.login', person, {
      headers: { 'user-agent': 'PgAgent/1.0 AGENT-MARKER' },
    });
    expect(login.ok).toBe(true);
    await app.settle();
    const opened = (await app.entries()).filter(
      (entry) => entry.eventType === 'auth.credential.loggedIn',
    );
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      actorKind: 'anonymous',
      userAgent: 'PgAgent/1.0 AGENT-MARKER',
    });
    const address = String(opened[0]?.remoteAddress);
    expect(address).toMatch(/^198\.1[89]\./);
    // The rows as the database holds them: sealed bytes, never the text.
    const raw = await app.rawEntries();
    expect(raw.length).toBeGreaterThan(0);
    for (const row of raw.filter((entry) => entry.remoteAddress !== undefined)) {
      expect(row.remoteAddress).toBeInstanceOf(Uint8Array);
    }
    const text = JSON.stringify(raw, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(text).not.toContain('AGENT-MARKER');
    expect(text).not.toContain(address);
  });
});
