import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { openStoredEvents, parseSealedValueText } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { dumpDatabase, findPlaintext, testOperator } from '@keelwerk/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPortalDatabase, type PortalDatabase } from './support/create-portal-database.ts';
import { type LocalPortal, startLocalPortal } from './support/local-portal.ts';
import { credentialsOf, freshPerson, sessionCookie } from './support/people.ts';

const operator = testOperator();
const userAgent = 'ErasureMarker/9.9 (portal test)';
const address = '203.0.113.77';
const newPassword = 'the current erasure marker password';

/** What an erased subject's session is afterwards (14.7.5, 17.2.4): erased, unresolvable, with no receipts. */
async function expectSessionGone(
  portal: LocalPortal,
  held: { readonly subject: string; readonly sessionId: string; readonly sessionToken: string },
): Promise<void> {
  const { runtime } = portal;
  const descriptor = (ref: string) => {
    const found = runtime.app.registry.entities.get(ref)?.descriptor;
    if (found === undefined) throw new Error(`the portal has no ${ref}`);
    return found;
  };
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  const { sessions, receipts } = await runtime.sealed.unit(
    runtime.namespace,
    scope,
    async (unit) => ({
      sessions: (
        await unit.rows.find(descriptor('auth.session'), {
          includeArchived: true,
          includeErased: true,
        })
      ).rows.filter((row) => row.subject === held.subject),
      receipts: (
        await unit.rows.find(descriptor('core.commandReceipt'), {
          where: { op: 'eq', field: 'principalId', value: held.sessionId },
          includeArchived: true,
        })
      ).rows.filter((row) => row.action !== 'core.eraseSubject'),
    }),
    { readOnly: true },
  );
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.kwErasedAt).toBeDefined();
  expect(sessions[0]?.archivedAt).toBeDefined();
  expect(receipts).toEqual([]);
  const opened = await runtime.invoker.open({
    transport: 'test',
    headers: {
      'x-tenant': runtime.tenants.acme.id,
      cookie: `${sessionCookie}=${held.sessionToken}`,
    },
  });
  expect(opened.ok && opened.value.principal.kind).toBe('anonymous');
}

describe('erasing a portal user (criterion 5, first half)', () => {
  let urls: PortalDatabase;
  let portal: LocalPortal;
  const worker = erasure({ pollMs: 3_600_000 });

  beforeAll(async () => {
    urls = await createPortalDatabase('portal_erasure');
    portal = await startLocalPortal(
      { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
      { workers: true, eventWorkers: [worker] },
    );
  }, 120_000);

  afterAll(() => portal?.runtime.stop());

  test('the dump holds none of the user markers and the history of the profile reads redacted', {
    timeout: 180_000,
  }, async () => {
    const { runtime } = portal;
    const person = freshPerson('erasure');
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    expect((await portal.request('auth.signUp', person)).ok).toBe(true);
    const login = await runtime.invoker.invoke({
      action: 'auth.login',
      input: credentialsOf(person),
      carrier: {
        transport: 'test',
        headers: { 'x-tenant': runtime.tenants.acme.id, 'user-agent': userAgent },
        connection: {
          id: 'c1',
          listener: 'http',
          remote: { address, port: 40_000 },
          local: { address: '127.0.0.1', port: 80 },
        },
      },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    if (!login.ok) throw login.error;
    const { sessionToken, sessionId } = login.value as { sessionToken: string; sessionId: string };
    // A command the session runs leaves a receipt whose principal is the session.
    const extended = await portal.request(
      'auth.extendSession',
      { sessionId },
      { headers: { authorization: `Bearer ${sessionToken}` } },
    );
    expect(extended.ok).toBe(true);
    const link = await portal
      .client(operator)
      .invoke('auth.issueResetLink', { identifier: person.identifier });
    expect(
      (await portal.request('auth.resetPassword', { token: link.token, newPassword })).ok,
    ).toBe(true);

    const descriptor = (ref: string) => {
      const found = runtime.app.registry.entities.get(ref)?.descriptor;
      if (found === undefined) throw new Error(`the portal has no ${ref}`);
      return found;
    };
    const subject = await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
      const [credential] = (await unit.rows.find(descriptor('auth.credential'), {})).rows;
      return String(credential?.subject);
    });
    const formerHash = await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
      const rows = (await unit.rows.find(descriptor('auth.credential'), { includeArchived: true }))
        .rows;
      const hashes: string[] = [];
      const texts: string[] = [];
      for (const row of rows) {
        const sealed = parseSealedValueText(String(row.verifier));
        const opened = sealed === undefined ? undefined : await unit.keys.openValue(sealed);
        if (opened !== undefined) {
          hashes.push(new TextDecoder().decode(opened));
          texts.push(String(row.verifier));
        }
      }
      return { hashes, texts };
    });
    // The control: before the erasure, the key service opens every sealed verifier to its hash.
    expect(formerHash.hashes.length).toBeGreaterThan(0);
    const openable = (texts: readonly string[]) =>
      runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
        let count = 0;
        for (const text of texts) {
          const sealed = parseSealedValueText(text);
          if (sealed !== undefined && (await unit.keys.openValue(sealed)) !== undefined) {
            count += 1;
          }
        }
        return count;
      });
    expect(await openable(formerHash.texts)).toBe(formerHash.texts.length);

    // Signing up created the profile under the same address; a second registrant meets the declared error.
    const profileId = await runtime.sealed.unit(runtime.namespace, scope, async (unit) =>
      String((await unit.rows.find(descriptor('accounts.profile'), {})).rows[0]?.id),
    );
    const second = await portal.request('accounts.register', {
      displayName: 'second registrant',
      email: person.identifier,
    });
    expect(second.ok).toBe(false);

    // The control for the personal values: the subject's and the profile's data keys exist.
    const dataKeyIds = await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
      const found: string[] = [];
      for (const id of [subject, profileId]) {
        const key = await unit.keys.dataKey(id, { create: false });
        if (key !== undefined) found.push(key.id);
      }
      return found;
    });
    expect(dataKeyIds.length).toBeGreaterThan(0);

    const markers = [
      ...formerHash.hashes,
      person.password,
      newPassword,
      sessionToken,
      link.token,
      person.identifier,
      userAgent,
      address,
    ];
    const client = new pg.Client({ connectionString: urls.adminUrl });
    await client.connect();
    try {
      const query = async (sql: string) => (await client.query(sql)).rows;
      const before = await dumpDatabase(query);
      expect(before).toContain('$kwe');
      // The receipt of the login keeps the request's user agent and address as columns until the erasure purges them.
      expect(findPlaintext(before, markers)).toEqual([userAgent, address]);

      for (const subjectId of [subject, profileId]) {
        await portal.client(operator).invoke(
          'core.eraseSubject',
          { subjectId: subjectId as never, reason: 'subjectRequest' },
          {
            prefer: 'async',
          },
        );
        await runtime.drainJobs();
      }
      await worker.pass();
      await runtime.drainJobs();

      const after = await dumpDatabase(query);
      expect(findPlaintext(after, markers)).toEqual([]);
      // Not only absent in the clear: every key that sealed a value of the user is gone, so the
      // ciphertext that is left cannot be opened (the verifiers' value keys and the data keys).
      expect(await openable(formerHash.texts)).toBe(0);
      const alive = await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
        const open: string[] = [];
        for (const id of dataKeyIds) if ((await unit.keys.keyById(id)) !== undefined) open.push(id);
        return open;
      });
      expect(alive).toEqual([]);
      // The session the user held is erased with them: its row is an erased tombstone, it no longer
      // resolves, and the receipts of the commands it ran are gone.
      await expectSessionGone(portal, { subject, sessionId, sessionToken });
      // The destroyed value keys are in the ledger as tombstones, so a restore shreds them again (14.7.6).
      const tombstoned = await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        async (unit) =>
          new Set(
            ((await unit.ledger?.since(0n, 1000)) ?? [])
              .map((entry) => entry.record)
              .flatMap((record) => (record.type === 'keyTombstone' ? [record.keyId] : [])),
          ),
        { readOnly: true },
      );
      const verifierKeys = formerHash.texts.map((text) => parseSealedValueText(text)?.keyId ?? '');
      expect(verifierKeys.some((keyId) => tombstoned.has(keyId))).toBe(true);
      // The control that the finder sees a plain field of the same user: the display name stays.
      expect(findPlaintext(after, [person.displayName])).toEqual([person.displayName]);
    } finally {
      await client.end();
    }

    // The history of the profile reads `{ redacted: true }` for the address (14.7.5).
    const history = await runtime.sealed.unit(runtime.namespace, scope, async (unit) =>
      openStoredEvents(
        unit,
        await unit.events.readStream({ type: 'accounts.profile', id: profileId }),
        'history',
      ),
    );
    const created = history.find((event) => event.type === 'accounts.profile.created');
    expect(created?.data).toMatchObject({ values: { email: { redacted: true } } });
    // The profile row is an erased tombstone: no read returns it, archived or not.
    const rows = await runtime.sealed.unit(
      runtime.namespace,
      scope,
      async (unit) =>
        (await unit.rows.find(descriptor('accounts.profile'), { includeArchived: true })).rows,
    );
    expect(rows.map((row) => row.id)).not.toContain(profileId);
  });
});
