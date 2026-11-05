import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { parseSealedValueText } from '@keelwerk/core';
import { dumpDatabase, findPlaintext, testOperator } from '@keelwerk/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPortalDatabase, type PortalDatabase } from './support/create-portal-database.ts';
import { type LocalPortal, startLocalPortal } from './support/local-portal.ts';
import { credentialsOf } from './support/people.ts';

const operator = testOperator();
const person = {
  identifier: 'dump.marker@example.org',
  password: 'the former dump marker password',
  displayName: 'DumpMarkerAda',
};
const newPassword = 'the current dump marker password';

describe('a PostgreSQL dump of the portal after sign-up, login and a password reset (exit criterion 6)', () => {
  let urls: PortalDatabase;
  let portal: LocalPortal;

  beforeAll(async () => {
    urls = await createPortalDatabase('portal_dump');
    portal = await startLocalPortal({
      factory: postgresAdapter({ ownerUrl: urls.adminUrl }),
      url: urls.appUrl,
    });
  }, 120_000);

  afterAll(() => portal?.runtime.stop());

  test('holds no former password hash, no plaintext secret and no plaintext personal marker', {
    timeout: 120_000,
  }, async () => {
    const signedUp = await portal.request('auth.signUp', person);
    expect(signedUp.ok).toBe(true);
    const { runtime } = portal;
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const descriptor = runtime.app.registry.entities.get('auth.credential')?.descriptor;
    if (descriptor === undefined) throw new Error('the portal has no auth.credential');
    const formerHash = await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
      const [row] = (await unit.rows.find(descriptor, {})).rows;
      const sealed = parseSealedValueText(String(row?.verifier));
      const opened = sealed === undefined ? undefined : await unit.keys.openValue(sealed);
      return opened === undefined ? '' : new TextDecoder().decode(opened);
    });
    expect(formerHash).toMatch(/^\$argon2id\$/);

    const login = await portal.request('auth.login', credentialsOf(person));
    if (!login.ok) throw login.error;
    const sessionToken = (login.value as { sessionToken: string }).sessionToken;
    const link = await portal
      .client(operator)
      .invoke('auth.issueResetLink', { identifier: person.identifier });
    const reset = await portal.request('auth.resetPassword', { token: link.token, newPassword });
    expect(reset.ok).toBe(true);
    const again = await portal.request('auth.login', {
      ...credentialsOf(person),
      password: newPassword,
    });
    expect(again.ok).toBe(true);

    const owner = new pg.Client({ connectionString: urls.adminUrl });
    await owner.connect();
    try {
      const dump = await dumpDatabase(async (sql) => (await owner.query(sql)).rows);
      // The control: the finder does see a value stored in the clear, so an empty answer means something.
      expect(findPlaintext(dump, ['auth.credential'])).toEqual(['auth.credential']);
      expect(dump).toContain('$kwe');
      const markers = [
        formerHash,
        person.password,
        newPassword,
        sessionToken,
        link.token,
        person.identifier,
      ];
      // the display name is a plain field of the profile: the control that the finder sees it
      expect(findPlaintext(dump, [person.displayName])).toEqual([person.displayName]);
      expect(findPlaintext(dump, markers)).toEqual([]);
    } finally {
      await owner.end();
    }
  });
});
