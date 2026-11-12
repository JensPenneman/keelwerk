import { dumpDatabase, findPlaintext, type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createKey, keyOwner, unknownKey } from './support/api-key-calls.ts';
import {
  type BootedApiKeys,
  bootApiKeys,
  bootedAt,
  type KeysStorage,
} from './support/boot-api-keys.ts';

const json = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint' ? member.toString() : member,
  );

describe.each(['memory', 'pglite'] as const)('api-keys secrecy on %s', (kind: KeysStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(lines: LoggedLine[]): Promise<BootedApiKeys> {
    const app = await bootApiKeys(kind, { logger: recordingLogger(lines) });
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  async function dumpOf(app: BootedApiKeys): Promise<string> {
    const owner = app.runtime.adapter;
    if (!('asOwner' in owner) || typeof owner.asOwner !== 'function') {
      throw new Error('the PGlite adapter has no owner connection');
    }
    const asOwner = owner.asOwner.bind(owner) as (
      fn: (database: {
        query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
      }) => Promise<string>,
    ) => Promise<string>;
    return asOwner((database) => dumpDatabase(async (sql) => (await database.query(sql)).rows));
  }

  test('after create no row, event, receipt, ledger line, job or log line holds the key', {
    timeout,
  }, async () => {
    const lines: LoggedLine[] = [];
    const app = await boot(lines);
    const commandId = crypto.randomUUID();
    const created = await app
      .as(keyOwner)
      .attempt('api-keys.create', { label: 'laptop', scopes: ['write'] }, { commandId });
    if (!created.ok) throw created.error;
    const { key, id } = created.value as { key: string; id: string };
    const secret = key.split('_')[2] ?? '';
    expect(secret).toHaveLength(52);
    // Use the key, so its resolution, last-use timer and a queued job leave their traces too.
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    const queued = await app.withKey(
      key,
      'loans.lend',
      {
        bookTitle: 'Ulysses',
        dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z'),
      },
      { prefer: 'async', commandId: 'lend-secret' },
    );
    expect(queued.ok).toBe(true);
    await app.runtime.advanceTo(bootedAt.add({ hours: 2 }));
    const stored = await app.runtime.adapter.unit(
      app.runtime.namespace,
      app.scope,
      async (unit) => ({
        events: await unit.events.readAll(null, { limit: 1000 }),
        receipts: [await unit.receipts.get(commandId), await unit.receipts.get('lend-secret')],
      }),
    );
    expect(stored.events.events.length).toBeGreaterThan(0);
    const row = await app.row(id);
    for (const [name, value] of Object.entries({
      row,
      events: stored.events,
      receipts: stored.receipts,
      lines,
    })) {
      expect(json(value), name).not.toContain(secret);
      expect(json(value), name).not.toContain(key);
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(json(stored.receipts[0])).toContain(id);
    if (kind === 'pglite') {
      expect(findPlaintext(await dumpOf(app), [secret, key])).toEqual([]);
    }
  });

  test('a refused key leaves its secret in no error and no log line', { timeout }, async () => {
    const lines: LoggedLine[] = [];
    const app = await boot(lines);
    const issued = await createKey(app, {
      scopes: ['read'],
      expiresAt: bootedAt.add({ hours: 1 }),
    });
    const secret = issued.key.split('_')[2] ?? '';
    await app.runtime.advanceTo(bootedAt.add({ hours: 2 }));
    const stranger = unknownKey();
    const strangerSecret = stranger.split('_')[2] ?? '';
    const answers = [
      await app.withKey(issued.key, 'library.book.query', {}),
      await app.withKey(stranger, 'library.book.query', {}),
      await app.withKey(`${issued.key}x`, 'library.book.query', {}),
    ];
    expect(answers.every((answer) => !answer.ok)).toBe(true);
    for (const [markers, name] of [
      [[secret, issued.key], 'the expired key'],
      [[strangerSecret, stranger], 'the unknown key'],
    ] as const) {
      expect(json(answers), name).not.toContain(markers[0]);
      expect(json(answers), name).not.toContain(markers[1]);
      expect(json(lines), name).not.toContain(markers[0]);
    }
    if (kind === 'pglite') {
      expect(findPlaintext(await dumpOf(app), [secret, strangerSecret])).toEqual([]);
    }
  });
});
