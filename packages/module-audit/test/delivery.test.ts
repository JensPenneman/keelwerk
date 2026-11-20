import { describe, expect, onTestFinished, test } from 'vitest';
import { blindDuplicateGuards } from './support/blind-duplicate-guards.ts';
import { type AuditStorage, aloneApp, auditBootedAt, bootAudit } from './support/boot-audit.ts';
import { failFirstEntry } from './support/fail-first-entry.ts';
import { holdReactionJobs } from './support/hold-reaction-jobs.ts';
import { adaUser } from './support/people.ts';

describe('the delivery of events to the audit reaction', () => {
  async function boot() {
    const app = await bootAudit(aloneApp, 'memory');
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  test('a job that fails once and is retried leaves one entry', async () => {
    const app = await boot();
    const failing = failFirstEntry(app.runtime.adapter);
    await app.client(adaUser).invoke('notes.note.create', { title: 'a' });
    await app.settle();
    expect(failing.refused()).toBe(1);
    expect(await app.entries()).toEqual([]);
    await app.runtime.advanceTo(auditBootedAt.add({ hours: 1 }));
    await app.settle();
    const entries = await app.entries();
    expect(entries.map((entry) => entry.eventType)).toEqual(['notes.note.created']);
  });

  test('a copy of a finished job leaves one entry, inside and after the receipt window', async () => {
    const app = await boot();
    const jobs = holdReactionJobs(app.runtime.adapter, false);
    await app.client(adaUser).invoke('notes.note.create', { title: 'a' });
    await app.settle();
    expect(await app.entries()).toHaveLength(1);
    const [original] = jobs.enqueued;
    if (original === undefined) throw new Error('no reaction job was queued');
    const copy = async (name: string) => {
      await app.runtime.adapter.unit(app.runtime.namespace, original.scope, async (unit) => {
        await unit.jobs.enqueue({ ...original, key: { value: name, onConflict: 'keep' } });
      });
      await app.settle();
    };
    await copy('copy-inside-the-window');
    expect(await app.entries()).toHaveLength(1);
    await app.runtime.advanceTo(auditBootedAt.add({ hours: 25 }));
    await app.retention.pass();
    await copy('copy-after-the-window');
    expect(await app.entries()).toHaveLength(1);
    expect(
      jobs.outcomes.map((outcome) => outcome.kind).filter((kind) => kind !== 'succeeded'),
    ).toEqual([]);
    expect(jobs.outcomes.length).toBeGreaterThanOrEqual(3);
  });
});

describe.each(['memory', 'pglite'] as const)(
  'two jobs of one event after the receipt window on %s',
  (kind: AuditStorage) => {
    test('both pass the guard before either commits: one entry, and every job ends succeeded', {
      timeout: kind === 'pglite' ? 60_000 : 10_000,
    }, async () => {
      const app = await bootAudit(aloneApp, kind);
      onTestFinished(() => app.runtime.stop());
      const jobs = holdReactionJobs(app.runtime.adapter);
      const made = await app.client(adaUser).attempt('notes.note.create', { title: 'a' });
      if (!made.ok || made.commandId === undefined) throw new Error('the note was not created');
      await app.settle();
      const [original] = jobs.enqueued;
      if (original === undefined) throw new Error('no reaction job was queued');
      await app.runtime.advanceTo(auditBootedAt.add({ hours: 25 }));
      await app.retention.pass();
      const commandId = made.commandId;
      expect(await app.inUnit((unit) => unit.receipts.get(commandId))).toBeUndefined();
      await app.runtime.adapter.unit(app.runtime.namespace, original.scope, async (unit) => {
        await unit.jobs.enqueue({ ...original, key: { value: 'second-copy', onConflict: 'keep' } });
      });
      // Both jobs find no receipt and no entry: what a store that runs them at once shows them.
      const guard = blindDuplicateGuards(app.runtime.adapter, 2);
      jobs.release();
      await app.settle();
      expect(guard.lookups()).toBe(2);
      expect(guard.claims()).toBeGreaterThanOrEqual(1);
      const entries = await app.entries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ eventType: 'notes.note.created' });
      expect(jobs.outcomes.filter((outcome) => outcome.kind === 'succeeded')).toHaveLength(
        jobs.outcomes.length,
      );
      expect(jobs.outcomes.length).toBeGreaterThanOrEqual(2);
    });
  },
);
