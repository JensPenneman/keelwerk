import { describe, expect, onTestFinished, test } from 'vitest';
import { type AuditStorage, aloneApp, auditBootedAt, bootAudit } from './support/boot-audit.ts';
import { holdReactionJobs } from './support/hold-reaction-jobs.ts';
import { adaUser } from './support/people.ts';

describe.each(['memory', 'pglite'] as const)(
  'audit entries and retention on %s',
  (kind: AuditStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;
    const later = auditBootedAt.add({ hours: 25 });

    async function boot() {
      const app = await bootAudit(aloneApp, kind);
      onTestFinished(() => app.runtime.stop());
      return app;
    }

    const receiptOf = (app: Awaited<ReturnType<typeof boot>>, commandId: string) =>
      app.inUnit((unit) => unit.receipts.get(commandId));

    test('a retention pass after the receipt window purges receipts and leaves every entry with its request metadata', {
      timeout,
    }, async () => {
      const app = await boot();
      const made = await app.client(adaUser).attempt('notes.note.create', { title: 'a' });
      if (!made.ok || made.commandId === undefined) throw new Error('the note was not created');
      await app.settle();
      const [before] = await app.entries();
      expect(await receiptOf(app, made.commandId)).toBeDefined();
      await app.runtime.advanceTo(later);
      await app.retention.pass();
      await app.settle();
      expect(await receiptOf(app, made.commandId)).toBeUndefined();
      const entries = await app.entries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ eventId: before?.eventId, transport: 'test' });
      expect(before?.remoteAddress).toMatch(/^198\.1[89]\./);
      expect(before?.transport).toBe('test');
      expect(entries[0]?.remoteAddress).toBe(before?.remoteAddress);
    });

    test('a job that runs after its receipt was purged writes the entry without request metadata', {
      timeout,
    }, async () => {
      const app = await boot();
      const jobs = holdReactionJobs(app.runtime.adapter);
      const made = await app.client(adaUser).attempt('notes.note.create', { title: 'a' });
      if (!made.ok || made.commandId === undefined) throw new Error('the note was not created');
      await app.settle();
      await app.runtime.advanceTo(later);
      await app.retention.pass();
      expect(await receiptOf(app, made.commandId)).toBeUndefined();
      jobs.release();
      await app.settle();
      const entries = await app.entries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).not.toHaveProperty('transport');
      expect(entries[0]).not.toHaveProperty('remoteAddress');
      expect(entries[0]).not.toHaveProperty('userAgent');
      expect(entries[0]).toMatchObject({ eventType: 'notes.note.created', actorKind: 'user' });
    });
  },
);
