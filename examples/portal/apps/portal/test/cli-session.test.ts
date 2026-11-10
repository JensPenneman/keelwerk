import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type DevSession, startDevSession } from './support/dev-session.ts';
import { freshPerson } from './support/people.ts';
import { portalConfig } from './support/portal-config.ts';
import { startSessionTimeoutMs } from './support/start-session-timeout-ms.ts';

let session: DevSession;
const person = freshPerson();

beforeAll(async () => {
  session = await startDevSession();
}, startSessionTimeoutMs);

afterAll(async () => {
  await session?.stop();
}, 120_000);

function idOf(text: string): string {
  const value = JSON.parse(text) as { id?: unknown };
  if (typeof value.id !== 'string') throw new Error(`no id in ${text}`);
  return value.id;
}

describe('keelwerk login and keelwerk call against the running dev deployment, over loopback HTTP (S-42)', () => {
  test('the control path creates the backend and the tenant, and the tenant takes a sign-up over REST', async () => {
    const backend = await session.keelwerk([
      'backend',
      'create',
      'portal',
      '--app',
      'portal',
      '--placement',
      'default',
      '--settings',
      JSON.stringify(portalConfig),
      '--output',
      'json',
    ]);
    expect(backend.stderr).toBe('');
    expect(backend.code).toBe(0);
    expect(idOf(backend.stdout)).toMatch(/^bknd_/);
    const tenant = await session.keelwerk([
      'tenant',
      'create',
      'acme',
      '--backend',
      'portal',
      '--domain',
      '127.0.0.1',
      '--output',
      'json',
    ]);
    expect(tenant.stderr).toBe('');
    expect(tenant.code).toBe(0);
    expect(idOf(tenant.stdout)).toMatch(/^tnt_/);
    const response = await fetch(`${session.url}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(person),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ credentialId: expect.stringMatching(/^cred_/) });
  }, 120_000);

  test('login stores the session token of the remote profile, never printing it', async () => {
    session.writeProfiles({ portal: { url: session.url } }, 'portal');
    const login = await session.keelwerk(
      ['login', '--input', JSON.stringify({ identifier: person.identifier })],
      { stdin: `${person.password}\n` },
    );
    expect(login.stderr).toBe('');
    expect(login.code).toBe(0);
    expect(login.stdout).toContain('Signed in to portal');
    const file = join(session.configHome, 'keelwerk', 'credentials.json');
    const stored = JSON.parse(readFileSync(file, 'utf8')) as {
      credentials: Record<string, { token: string }>;
    };
    const token = stored.credentials.portal?.token ?? '';
    expect(token).toMatch(/^pss_/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(login.stdout + login.stderr).not.toContain(token);
    expect(login.stdout + login.stderr).not.toContain(person.password);
  }, 60_000);

  test('call sends the stored token: whoami answers the person, and a profile without a token is refused', async () => {
    const called = await session.keelwerk(['call', 'auth.whoami', '--output', 'json']);
    expect(called.stderr).toBe('');
    expect(called.code).toBe(0);
    expect(JSON.parse(called.stdout)).toMatchObject({ displayName: person.displayName });
    const bare = join(session.configHome, 'bare');
    session.writeProfiles({ portal: { url: session.url } }, 'portal', bare);
    const refused = await session.keelwerk(['call', 'auth.whoami', '--output', 'json'], {
      configHome: bare,
    });
    expect(refused.code).toBe(4);
    expect(refused.stdout).not.toContain(person.displayName);
  }, 60_000);

  test('a wrong password stores nothing new and exits with the unauthenticated code', async () => {
    const file = join(session.configHome, 'keelwerk', 'credentials.json');
    const before = readFileSync(file);
    const wrong = await session.keelwerk(
      ['login', '--input', JSON.stringify({ identifier: person.identifier })],
      { stdin: 'not the password at all\n' },
    );
    expect(wrong.code).toBe(4);
    expect(wrong.stderr).toContain('"kind":"unauthenticated"');
    expect(wrong.stderr).toContain('auth.invalid_credentials');
    expect(readFileSync(file).equals(before)).toBe(true);
    const after = await session.keelwerk(['call', 'auth.whoami', '--output', 'json']);
    expect(after.code).toBe(0);
  }, 60_000);
});
