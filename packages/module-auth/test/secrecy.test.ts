import { argon2Sync } from 'node:crypto';
import type { Logger } from '@keelwerk/core';
import { dummyVerifier, needsRehash, parseSealedValueText } from '@keelwerk/core';
import { dumpDatabase, findPlaintext } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { verifierOrDummy } from '../src/lib/verifier-or-dummy.ts';
import { ada, enrol, signIn } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';
import { capturingLogger } from './support/capturing-logger.ts';

const json = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) => {
    if (typeof member === 'bigint') return member.toString();
    return member instanceof Uint8Array ? [...member] : member;
  });

/** An Argon2id hash in PHC form with parameters other than the current ones. */
function oldHash(password: string): string {
  const salt = new Uint8Array(16).fill(3);
  const tag = argon2Sync('argon2id', {
    message: Buffer.from(password),
    nonce: salt,
    memory: 8192,
    passes: 1,
    parallelism: 1,
    tagLength: 32,
  });
  const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/=+$/, '');
  return ['', 'argon2id', 'v=19', 'm=8192,t=1,p=1', text(salt), text(tag)].join('$');
}

describe('the dummy verifier', () => {
  test('is used for an unknown identifier and costs what a current hash costs', () => {
    expect(verifierOrDummy(undefined)).toBe(dummyVerifier);
    expect(verifierOrDummy('$argon2id$stored')).toBe('$argon2id$stored');
    expect(needsRehash(dummyVerifier)).toBe(false);
  });
});

describe.each(['memory', 'pglite'] as const)('auth secrecy on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(logger?: Logger): Promise<BootedAuth> {
    const auth = await bootAuth(kind, {}, logger);
    onTestFinished(() => auth.runtime.stop());
    return auth;
  }

  function descriptorOf(auth: BootedAuth, ref: string) {
    const found = auth.runtime.app.registry.entities.get(ref)?.descriptor;
    if (found === undefined) throw new Error(`no ${ref}`);
    return found;
  }

  test("the token's secret enters no event, no decision record, no row and no receipt, and a replay conflicts", {
    timeout,
  }, async () => {
    const captured = capturingLogger();
    const auth = await boot(captured.logger);
    const credentialId = await enrol(auth);
    const commandId = crypto.randomUUID();
    const first = await auth.request('auth.login', ada, { commandId });
    if (!first.ok) throw first.error;
    const { sessionToken, sessionId } = first.value as { sessionToken: string; sessionId: string };
    const secret = sessionToken.split('_')[2] ?? '';
    expect(secret).toHaveLength(52);
    const replay = await auth.request('auth.login', ada, { commandId });
    expect(replay.ok ? undefined : replay.error.kind).toBe('conflict');
    expect(json(replay)).not.toContain(secret);
    const session = descriptorOf(auth, 'auth.session');
    const stored = await auth.inUnit(async (unit) => ({
      sessions: (await unit.rows.find(session, { select: Object.keys(session.fields) })).rows,
      credentialEvents: await unit.events.readStream({ type: 'auth.credential', id: credentialId }),
    }));
    expect(stored.sessions.map((row) => row.id)).toContain(sessionId);
    expect(json(stored)).not.toContain(secret);
    expect(json(stored)).not.toContain(ada.password);
    const receipt = await auth.inUnit((unit) => unit.receipts.get(commandId));
    expect(receipt).toMatchObject({ action: 'auth.login', status: 'completed' });
    expect(json(receipt)).not.toContain(secret);
    expect(json(receipt)).toContain(sessionId);
    expect(captured.lines.length).toBeGreaterThan(0);
    expect(
      captured.lines.filter((line) => line.includes(secret) || line.includes(ada.password)),
    ).toEqual([]);
    if (kind === 'pglite') {
      const owner = auth.runtime.adapter;
      if (!('asOwner' in owner) || typeof owner.asOwner !== 'function') {
        throw new Error('the PGlite adapter has no owner connection');
      }
      const asOwner = owner.asOwner.bind(owner) as (
        fn: (database: {
          query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
        }) => Promise<string>,
      ) => Promise<string>;
      const dump = await asOwner((database) =>
        dumpDatabase(async (sql) => (await database.query(sql)).rows),
      );
      expect(findPlaintext(dump, [secret, ada.password])).toEqual([]);
    }
  });

  test('the password and its hash are sealed in the stored events', { timeout }, async () => {
    const auth = await boot();
    const credentialId = await enrol(auth);
    const events = await auth.inUnit((unit) =>
      unit.events.readStream({ type: 'auth.credential', id: credentialId }),
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(json(events)).not.toContain('argon2id');
    expect(json(events)).not.toContain(ada.password);
    expect(json(events)).not.toContain(ada.identifier);
  });

  test('client metadata of a session is personal: sealed in the store', { timeout }, async () => {
    const auth = await boot();
    await enrol(auth);
    const done = await auth.request('auth.login', ada, {
      address: '203.0.113.9',
      headers: { 'user-agent': 'SpecialAgent/7.1' },
    });
    expect(done.ok).toBe(true);
    const session = descriptorOf(auth, 'auth.session');
    const select = Object.keys(session.fields);
    const raw = await auth.inUnit((unit) => unit.rows.find(session, { select }));
    expect(json(raw)).not.toContain('203.0.113.9');
    expect(json(raw)).not.toContain('SpecialAgent');
    const opened = await auth.inUnit((unit) => unit.rows.find(session, { select }), {
      sealed: true,
    });
    expect(json(opened)).toContain('203.0.113.9');
  });

  test('a login rehashes a verifier made with other parameters', { timeout }, async () => {
    const auth = await boot();
    const credentialId = await enrol(auth);
    const credential = descriptorOf(auth, 'auth.credential');
    const select = Object.keys(credential.fields);
    const old = oldHash(ada.password);
    expect(needsRehash(old)).toBe(true);
    const rowOf = (unit: Parameters<Parameters<BootedAuth['inUnit']>[0]>[0]) =>
      unit.rows.findOne(credential, {
        where: { op: 'eq', field: 'id', value: credentialId },
        select,
      });
    await auth.inUnit(
      async (unit) => {
        const row = await rowOf(unit);
        if (row === undefined) throw new Error('no credential row');
        const version = Number(row.version);
        await unit.rows.update(credential, [
          {
            id: credentialId,
            expectedVersion: version,
            values: { ...row, verifier: old, version },
          },
        ]);
      },
      { sealed: true },
    );
    const verifierNow = async () =>
      String((await auth.inUnit(async (unit) => rowOf(unit), { sealed: true }))?.verifier);
    expect(await verifierNow()).toBe(old);
    await signIn(auth);
    const rehashed = await verifierNow();
    expect(rehashed).not.toBe(old);
    const sealed = parseSealedValueText(rehashed);
    if (sealed === undefined) throw new Error('the verifier is not sealed');
    const opened = await auth.inUnit((unit) => unit.keys.openValue(sealed));
    const hash = new TextDecoder().decode(opened);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(needsRehash(hash)).toBe(false);
    await signIn(auth);
  });
});
