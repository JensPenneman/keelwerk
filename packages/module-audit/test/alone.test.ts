import { reactionMatches } from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { type AuditStorage, aloneApp, bootAudit } from './support/boot-audit.ts';
import { adaSubject, adaUser, adminAda } from './support/people.ts';

const excepted = [
  'audit.entry.archived',
  'audit.entry.changed',
  'audit.entry.created',
  'audit.entry.erased',
  'audit.entry.restored',
];

describe.each(['memory', 'pglite'] as const)('audit alone on %s', (kind: AuditStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot() {
    const app = await bootAudit(aloneApp, kind);
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  test('the registry lists audit as an observer with its except list', { timeout }, async () => {
    const app = await boot();
    const reaction = app.runtime.app.registry.reactions.get('audit.recordEvent');
    expect(reaction?.on).toBe('all');
    expect([...(reaction?.except ?? [])].sort()).toEqual(excepted);
  });

  test('a note created over a request leaves one entry with actor, action, command id, event type, stream and request metadata', {
    timeout,
  }, async () => {
    const app = await boot();
    const created = await app.client(adaUser).attempt('notes.note.create', { title: 'first' });
    expect(created.ok).toBe(true);
    await app.settle();
    const entries = await app.entries();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      eventType: 'notes.note.created',
      streamType: 'notes.note',
      streamVersion: 1,
      action: 'notes.note.create',
      actorKind: 'user',
      subject: adaSubject,
      transport: 'test',
    });
    expect(entry?.commandId).toEqual(expect.any(String));
    expect(entry?.actorId).toBeUndefined();
    expect(String(entry?.remoteAddress)).toMatch(/^198\.1[89]\./);
    expect(entry?.userAgent === undefined || typeof entry.userAgent === 'string').toBe(true);
    expect(Object.keys(entry ?? {}).filter((key) => key === 'title' || key === 'data')).toEqual([]);
  });

  test('one job per event per tenant (acme and globex), and no own event type matches the reaction', {
    timeout,
  }, async () => {
    const app = await boot();
    await app.client(adaUser, 'acme').invoke('notes.note.create', { title: 'a' });
    await app.client(adaUser, 'globex').invoke('notes.note.create', { title: 'g' });
    await app.settle();
    const acme = await app.entries('acme');
    const globex = await app.entries('globex');
    expect(acme.map((entry) => entry.eventType)).toEqual(['notes.note.created']);
    expect(globex.map((entry) => entry.eventType)).toEqual(['notes.note.created']);
    expect(acme[0]?.eventId).not.toBe(globex[0]?.eventId);
    const entry = app.runtime.app.registry.reactions.get('audit.recordEvent');
    if (entry === undefined) throw new Error('no audit reaction');
    for (const type of excepted) expect(reactionMatches(entry, type)).toBe(false);
    expect(reactionMatches(entry, 'notes.note.created')).toBe(true);
    // A read of the entries is itself no event: nothing new appears.
    await app.client(adminAda).invoke('audit.entry.query', {});
    await app.settle();
    expect(await app.entries('acme')).toHaveLength(1);
  });
});
