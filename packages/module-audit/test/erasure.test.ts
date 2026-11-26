import { describe, expect, onTestFinished, test } from 'vitest';
import { type AuditStorage, aloneApp, bootAudit } from './support/boot-audit.ts';
import { holdReactionJobs } from './support/hold-reaction-jobs.ts';
import { adaSubject, adaUser, graceSubject, graceUser } from './support/people.ts';

describe.each(['memory', 'pglite'] as const)(
  'audit entries and erasure on %s',
  (kind: AuditStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot() {
      const app = await bootAudit(aloneApp, kind);
      onTestFinished(() => app.runtime.stop());
      return app;
    }

    test("after the erasure of its subject no entry of theirs is listed, got or opened, and another person's entries stay", {
      timeout,
    }, async () => {
      const app = await boot();
      // Ada's request carries an agent, so there is a sealed agent for the erasure to clear.
      const created = await app.request(
        'notes.note.create',
        { title: 'a' },
        { principal: adaUser, headers: { 'user-agent': 'AdaAgent/1.0' } },
      );
      if (!created.ok) throw created.error;
      await app.client(graceUser).invoke('notes.note.create', { title: 'g' });
      await app.settle();
      const before = await app.entries();
      const adas = before.find((entry) => entry.subject === adaSubject);
      const graces = before.find((entry) => entry.subject === graceSubject);
      expect(adas?.remoteAddress).toBeDefined();
      expect(adas?.userAgent).toBe('AdaAgent/1.0');
      if (adas === undefined || graces === undefined) throw new Error('entries are missing');

      await app.erase(adaSubject);

      const after = await app.entries();
      expect(after.map((entry) => entry.eventId)).toEqual([graces.eventId]);
      const page = await app.operator('acme').invoke('audit.entry.query', {});
      expect(page.items.map((item) => item.eventId)).toEqual([graces.eventId]);
      const got = await app
        .operator('acme')
        .attempt('audit.entry.get', { ids: [String(adas.id)] as never });
      expect(got.ok ? got.value.list : []).toEqual([]);
      // The tombstone of the erased entry remains, without the personal fields; the other
      // person's entry is untouched.
      const raw = await app.rawEntries('acme', { includeErased: true });
      const adaRow = raw.find((row) => row.eventId === adas.eventId);
      expect(adaRow?.kwErasedAt).toBeTruthy();
      expect(adaRow?.remoteAddress).toBeUndefined();
      expect(adaRow?.userAgent).toBeUndefined();
      const graceRow = raw.find((row) => row.eventId === graces.eventId);
      expect(graceRow).toBeDefined();
      expect(graceRow?.kwErasedAt ?? null).toBeNull();
    });

    test('the job of an event whose subject was erased before it ran writes nothing and ends succeeded, with no dead letter', {
      timeout,
    }, async () => {
      const app = await boot();
      const jobs = holdReactionJobs(app.runtime.adapter);
      const first = await app.client(adaUser).invoke('notes.note.create', { title: 'first' });
      await app.client(graceUser).invoke('notes.note.create', { title: 'first' });
      await app.settle();
      expect(await app.entries()).toHaveLength(0);
      // The person is known to the erasure by a reference, and has no data key: the erasure
      // makes a destroyed one, so the held job cannot make a live one (D5).
      await app.inUnit(async (unit) => {
        await unit.keys.addRefs(adaSubject, [{ type: 'notes.note', id: String(first.id) }]);
      });
      expect(
        await app.inUnit((unit) => unit.keys.dataKey(adaSubject, { create: false })),
      ).toBeUndefined();
      await app.erase(adaSubject);
      jobs.release();
      await app.settle();
      const entries = await app.entries();
      expect(entries.map((entry) => entry.subject)).toEqual([graceSubject]);
      expect(jobs.outcomes.length).toBeGreaterThan(0);
      expect(
        jobs.outcomes.map((outcome) => outcome.kind).filter((kind) => kind !== 'succeeded'),
      ).toEqual([]);
    });
  },
);
