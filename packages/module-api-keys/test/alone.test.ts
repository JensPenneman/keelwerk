import { describe, expect, onTestFinished, test } from 'vitest';
import {
  createKey,
  keyOwner,
  keyOwnerSubject,
  otherPerson,
  refusalOf,
  unknownKey,
} from './support/api-key-calls.ts';
import {
  type BootedApiKeys,
  bootApiKeys,
  bootedAt,
  type KeysStorage,
} from './support/boot-api-keys.ts';

const hours = (count: number): Temporal.Instant => bootedAt.add({ hours: count });
const lend = { bookTitle: 'Ulysses', dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z') };
const readOnlyReason = 'This API key has the read scope only.';

describe.each(['memory', 'pglite'] as const)('api-keys alone on %s', (kind: KeysStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedApiKeys> {
    const app = await bootApiKeys(kind);
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  test('create answers the key once: kwk format, a replay is conflict, the receipt holds no secret', {
    timeout,
  }, async () => {
    const app = await boot();
    const commandId = crypto.randomUUID();
    const input = { label: 'laptop', scopes: ['read'] };
    const first = await app.as(keyOwner).attempt('api-keys.create', input, { commandId });
    if (!first.ok) throw first.error;
    const { key, id, publicId } = first.value as { key: string; id: string; publicId: string };
    expect(key).toMatch(/^kwk_[a-z2-7]{26}_[a-z2-7]{52}$/);
    expect(key.split('_')[1]).toBe(publicId);
    const secret = key.split('_')[2] ?? '';
    const replay = await app.as(keyOwner).attempt('api-keys.create', input, { commandId });
    expect(replay.ok ? undefined : replay.error.kind).toBe('conflict');
    expect(JSON.stringify(replay)).not.toContain(secret);
    const receipt = await app.receipt(commandId);
    expect(receipt?.status).toBe('completed');
    expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(JSON.stringify(receipt)).toContain(id);
  });

  test("a read-scoped key reads in every module and is denied every command with the rule's reason", {
    timeout,
  }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['read'] });
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    expect((await app.withKey(key, 'api-keys.key.query', {})).ok).toBe(true);
    const commands: readonly (readonly [string, unknown])[] = [
      ['library.addBook', { title: 'Dune', isbn: '978-0441172719' }],
      ['library.book.create', { title: 'Dune', isbn: '978-0441172719', addedBy: 'keyOwner' }],
      ['api-keys.key.revoke', { id }],
      ['loans.lend', lend],
    ];
    for (const [action, input] of commands) {
      const outcome = await app.withKey(key, action, input);
      expect(outcome.ok, action).toBe(false);
      expect(outcome.ok ? undefined : outcome.error.kind, action).toBe('forbidden');
      expect(outcome.ok ? '' : outcome.error.message, action).toContain(readOnlyReason);
    }
    const row = await app.row(id);
    expect(row?.revokedAt).toBeUndefined();
  });

  test('a write-scoped key acts as its owner', { timeout }, async () => {
    const app = await boot();
    const { key } = await createKey(app, { scopes: ['write'] });
    const opened = await app.open(key);
    if (!opened.ok) throw opened.error;
    expect(opened.value.principal).toMatchObject({
      kind: 'user',
      subject: keyOwnerSubject,
      via: 'api-keys.key',
      claims: { scopes: ['write'] },
    });
    const added = await app.withKey(key, 'library.addBook', {
      title: 'Dune',
      isbn: '978-0441172719',
    });
    expect(added.ok).toBe(true);
    const books = await app.as(keyOwner).invoke('library.book.query', {});
    expect(books.items.map((book) => book.addedBy)).toEqual([keyOwnerSubject]);
  });

  test('a key creates no key', { timeout }, async () => {
    const app = await boot();
    const { key } = await createKey(app, { scopes: ['write'] });
    const outcome = await app.withKey(key, 'api-keys.create', {
      label: 'child',
      scopes: ['write'],
    });
    expect(outcome.ok ? undefined : outcome.error.kind).toBe('forbidden');
    const keys = await app.as(keyOwner).invoke('api-keys.key.query', {});
    expect(keys.items).toHaveLength(1);
  });

  test("revoke and query follow the key's scopes: a write key revokes its own key", {
    timeout,
  }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['write'] });
    expect((await app.withKey(key, 'api-keys.key.revoke', { id })).ok).toBe(true);
    expect(refusalOf(await app.withKey(key, 'api-keys.key.query', {}))?.code).toBe(
      'core.unauthenticated',
    );
  });

  test('an unknown, revoked, expired or other-tenant key gets one refusal', {
    timeout,
  }, async () => {
    const app = await boot();
    const revoked = await createKey(app, { scopes: ['write'] });
    const expired = await createKey(app, { scopes: ['read'], expiresAt: hours(1) });
    const foreign = await createKey(app, { scopes: ['read'] });
    const revoke = await app.as(keyOwner).attempt('api-keys.key.revoke', { id: revoked.id });
    expect(revoke.ok).toBe(true);
    await app.runtime.advanceTo(hours(2));
    const refusals = await Promise.all([
      app.withKey(unknownKey(), 'library.book.query', {}),
      app.withKey(revoked.key, 'library.book.query', {}),
      app.withKey(expired.key, 'library.book.query', {}),
      app.withKey(foreign.key, 'library.book.query', {}, { tenant: 'globex' }),
    ]);
    const answers = refusals.map(refusalOf);
    expect(answers[0]).toMatchObject({ kind: 'unauthenticated', code: 'core.unauthenticated' });
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
  });

  test('a key of tenant acme is unknown in tenant globex', { timeout }, async () => {
    const app = await boot();
    const { key } = await createKey(app, { scopes: ['read'] });
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    const elsewhere = await app.withKey(key, 'library.book.query', {}, { tenant: 'globex' });
    expect(refusalOf(elsewhere)).toMatchObject({ kind: 'unauthenticated' });
    const theirs = await createKey(app, { scopes: ['read'] }, otherPerson);
    expect(theirs.key).not.toBe(key);
  });

  test('expiry: a key works before expiresAt and is refused from that instant', {
    timeout,
  }, async () => {
    const app = await boot();
    const { key } = await createKey(app, { scopes: ['read'], expiresAt: hours(1) });
    await app.runtime.advanceTo(hours(1).subtract({ minutes: 1 }));
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    await app.runtime.advanceTo(hours(1));
    expect(refusalOf(await app.withKey(key, 'library.book.query', {}))).toMatchObject({
      kind: 'unauthenticated',
    });
  });

  test('an expiry that is not in the future is a validation error', { timeout }, async () => {
    const app = await boot();
    const answer = await app.as(keyOwner).attempt('api-keys.create', {
      label: 'late',
      scopes: ['read'],
      expiresAt: bootedAt,
    });
    expect(answer.ok ? undefined : answer.error.kind).toBe('validation');
    const none = await app.as(keyOwner).attempt('api-keys.create', { label: 'none', scopes: [] });
    expect(none.ok ? undefined : none.error.kind).toBe('validation');
  });

  test('a key that names transports works only on them', { timeout }, async () => {
    const app = await boot();
    const { key } = await createKey(app, { scopes: ['read', 'transport:cli'] });
    const elsewhere = await app.withKey(key, 'library.book.query', {}, { transport: 'http' });
    expect(refusalOf(elsewhere)).toMatchObject({
      kind: 'unauthenticated',
      message: 'The API key was not accepted.',
    });
    expect((await app.withKey(key, 'library.book.query', {}, { transport: 'cli' })).ok).toBe(true);
  });

  test('queued work of a live key runs as its owner', { timeout }, async () => {
    const app = await boot();
    const { key } = await createKey(app, { scopes: ['write'] });
    const accepted = await app.withKey(key, 'loans.lend', lend, {
      prefer: 'async',
      commandId: 'lend-3',
    });
    expect(accepted.ok).toBe(true);
    await app.runtime.drainJobs();
    expect((await app.receipt('lend-3'))?.status).toBe('completed');
  });

  test('a revoked or expired key ends an open session at its next revalidation', {
    timeout,
  }, async () => {
    const app = await boot();
    const revoked = await createKey(app, { scopes: ['read'] });
    const session = await app.open(revoked.key);
    if (!session.ok) throw session.error;
    expect(session.value.dependsOn).toEqual([{ entity: 'api-keys.key', id: revoked.id }]);
    expect((await session.value.revalidate()).ok).toBe(true);
    await app.as(keyOwner).invoke('api-keys.key.revoke', { id: revoked.id });
    const afterRevoke = await session.value.revalidate();
    expect(afterRevoke.ok ? undefined : afterRevoke.error.kind).toBe('unauthenticated');
    const expiring = await createKey(app, { scopes: ['read'], expiresAt: hours(1) });
    const second = await app.open(expiring.key);
    if (!second.ok) throw second.error;
    await app.runtime.advanceTo(hours(1));
    const afterExpiry = await second.value.revalidate();
    expect(afterExpiry.ok ? undefined : afterExpiry.error.kind).toBe('unauthenticated');
  });

  test('list is the generated query: own keys only, no verifier member', { timeout }, async () => {
    const app = await boot();
    const mine = await createKey(app, { scopes: ['read'], label: 'mine' });
    await createKey(app, { scopes: ['read'], label: 'theirs' }, otherPerson);
    const listed = await app.as(keyOwner).invoke('api-keys.key.query', {});
    expect(listed.items.map((item) => item.id)).toEqual([mine.id]);
    expect(Object.keys(listed.items[0] ?? {})).not.toContain('verifier');
    expect(JSON.stringify(listed)).not.toContain(mine.key.split('_')[2]);
  });

  test('revoking a revoked key answers not_found: the deny rule hides the row from the command', {
    timeout,
  }, async () => {
    const app = await boot();
    const { id } = await createKey(app, { scopes: ['read'] });
    expect((await app.as(keyOwner).attempt('api-keys.key.revoke', { id })).ok).toBe(true);
    const again = await app.as(keyOwner).attempt('api-keys.key.revoke', { id });
    expect(again.ok ? undefined : again.error.kind).toBe('not_found');
    expect(app.runtime.app.registry.rules.get('api-keys.key.alreadyRevoked')?.effect).toBe('deny');
  });

  test('another person cannot see or revoke a key', { timeout }, async () => {
    const app = await boot();
    const { id } = await createKey(app, { scopes: ['read'] });
    const revoke = await app.as(otherPerson).attempt('api-keys.key.revoke', { id });
    expect(revoke.ok).toBe(false);
    expect((await app.as(otherPerson).invoke('api-keys.key.query', {})).items).toEqual([]);
    expect((await app.row(id))?.revokedAt).toBeUndefined();
  });

  test('the rules are mounted as selectors', { timeout }, async () => {
    const app = await boot();
    const { rules } = app.runtime.app.registry;
    const readOnly = rules.get('api-keys.readOnlyKey');
    expect(readOnly?.subject).toEqual({ kinds: ['command'] });
    expect(readOnly?.effect).toBe('deny');
    expect(rules.has('api-keys.appPassword')).toBe(false);
    const principalOf = (via: string, scopes: unknown) => ({
      principal: { via, claims: { scopes } },
    });
    expect(readOnly?.when?.(principalOf('api-keys.key', ['read']), {})).toBe(true);
    expect(readOnly?.when?.(principalOf('api-keys.key', ['write']), {})).toBe(false);
    expect(readOnly?.when?.(principalOf('test.principal', ['read']), {})).toBe(false);
    expect(readOnly?.when?.(principalOf('api-keys.key', 'read'), {})).toBe(true);
  });
});
