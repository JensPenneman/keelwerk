import { findPlaintext } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { auditDump } from './support/audit-dump.ts';
import { type AuditStorage, bootAudit, withAccountsApp } from './support/boot-audit.ts';
import { adminAda } from './support/people.ts';

const declared = [
  'action',
  'actorId',
  'actorKind',
  'actorVia',
  'at',
  'causationId',
  'commandId',
  'eventId',
  'eventType',
  'id',
  'remoteAddress',
  'streamId',
  'streamType',
  'streamVersion',
  'subject',
  'transport',
  'userAgent',
];
const system = /^(kw|tenant|created|updated|version|erased)/i;

const password = 'PASSWORD-MARKER-4f81 horse battery';
const cookie = 'COOKIE-MARKER-9c2e';
const bearer = 'BEARER-MARKER-77ab';
const address = '198.18.0.1';
const agent = 'AuditAgent/7.7 AGENT-MARKER-31d0';

describe.each(['memory', 'pglite'] as const)('audit secrecy on %s', (kind: AuditStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot() {
    const app = await bootAudit(withAccountsApp, kind);
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  async function activity(app: Awaited<ReturnType<typeof boot>>) {
    const person = { identifier: 'secret.ada@example.org', password };
    await app.request('auth.signUp', person, { headers: { 'user-agent': agent } });
    const login = await app.request('auth.login', person, { headers: { 'user-agent': agent } });
    if (!login.ok) throw login.error;
    const { sessionToken } = login.value as { sessionToken: string };
    // Stale credentials and a wrong password are requests too.
    await app.request(
      'auth.login',
      { ...person, password: `${password} wrong` },
      {
        headers: { cookie: `__Host-keelwerk_session=${cookie}`, 'user-agent': agent },
      },
    );
    await app.request('auth.whoami', {}, { headers: { authorization: `Bearer ${bearer}` } });
    await app.request(
      'auth.whoami',
      {},
      {
        headers: {
          authorization: `Bearer ${sessionToken}`,
          cookie: `x=${cookie}`,
          'user-agent': agent,
        },
      },
    );
    await app.settle();
    return sessionToken;
  }

  test('no password, session token, cookie, bearer token or secret input reaches an entry or the store', {
    timeout,
  }, async () => {
    const app = await boot();
    const token = await activity(app);
    const markers = [password, cookie, bearer, token, 'PASSWORD-MARKER'];
    const opened = await app.entries();
    const raw = await app.rawEntries();
    expect(opened.length).toBeGreaterThan(0);
    const text = JSON.stringify([opened, raw], (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(findPlaintext(text, markers)).toEqual([]);
    for (const entry of opened) {
      const extra = Object.keys(entry).filter(
        (key) => !declared.includes(key) && !system.test(key),
      );
      expect(extra).toEqual([]);
    }
    if (kind === 'pglite') {
      const dump = await auditDump([app.runtime.adapter, app.runtime.control.adapter], {
        receipts: true,
      });
      expect(dump.length).toBeGreaterThan(0);
      expect(findPlaintext(dump, markers)).toEqual([]);
    }
  });

  test('remote address and user agent are sealed: the dump without receipts shows neither, the raw row holds sealed bytes, a reader sees them', {
    timeout,
  }, async () => {
    const app = await boot();
    await activity(app);
    const raw = (await app.rawEntries()).filter((entry) => entry.remoteAddress !== undefined);
    expect(raw.length).toBeGreaterThan(0);
    for (const entry of raw) {
      // A sealed value is bytes of an envelope, never text.
      expect(entry.remoteAddress).toBeInstanceOf(Uint8Array);
      if (entry.userAgent !== undefined) expect(entry.userAgent).toBeInstanceOf(Uint8Array);
    }
    const opened = (await app.entries()).filter((entry) => entry.userAgent === agent);
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((entry) => /^198\.1[89]\./.test(String(entry.remoteAddress)))).toBe(true);
    const seen = await app.client(adminAda).invoke('audit.entry.query', {});
    expect(seen.items.some((item) => item.userAgent === agent)).toBe(true);
    if (kind === 'pglite') {
      const dump = await auditDump([app.runtime.adapter, app.runtime.control.adapter], {
        receipts: false,
      });
      expect(findPlaintext(dump, [agent, 'AGENT-MARKER', address])).toEqual([]);
      const control = await auditDump([app.runtime.adapter, app.runtime.control.adapter], {
        receipts: true,
      });
      // The control: the receipts do hold the agent, so the dump above was not blind.
      expect(findPlaintext(control, ['AGENT-MARKER'])).toEqual(['AGENT-MARKER']);
    }
  });
});
