import { evaluateGate, normalizeRule } from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { blindDuplicateGuards } from './support/blind-duplicate-guards.ts';
import {
  type AuditStorage,
  auditBootedAt,
  bootAudit,
  overriddenAccountsApp,
  overriddenAloneApp,
} from './support/boot-audit.ts';
import { holdReactionJobs } from './support/hold-reaction-jobs.ts';
import { adaSubject, adaUser } from './support/people.ts';

const person = { identifier: 'ada@example.org', password: 'correct horse battery staple' };

describe('the deny rule of audit.entry', () => {
  test('stops every principal kind on every write although an override allows every action to operators', async () => {
    const app = await bootAudit(overriddenAloneApp, 'memory');
    onTestFinished(() => app.runtime.stop());
    const { registry } = app.runtime.app;
    // The override composes with no problem and the module's deny stands beside it.
    expect(registry.rules.get('audit.entry.overrideAll')?.effect).toBe('allow');
    expect(registry.rules.get('audit.entry.noWrites')).toMatchObject({
      effect: 'deny',
      disabled: false,
    });
    const rules = [...registry.rules.values()]
      .filter((rule) => rule.disabled !== true)
      .map(normalizeRule);
    const get = registry.actions.get('audit.entry.get');
    if (get === undefined) throw new Error('no audit.entry.get');
    const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
    const context = (kind: string) =>
      ({
        principal: {
          kind,
          roles: ['admin'],
          subject: adaSubject,
          scope: { backend: 'b1', tenant: 't1' },
        },
        scope,
        flags: {},
      }) as never;
    const kinds = ['anonymous', 'user', 'service', 'operator', 'system'] as const;
    for (const operation of ['create', 'update', 'archive', 'restore'] as const) {
      // The entity mounts none of the four; the gate is asked as if it did.
      const action = {
        ...get,
        ref: `audit.entry.${operation}`,
        name: operation,
        kind: 'command',
        generated: operation,
      } as never;
      for (const kind of kinds) {
        const verdict = evaluateGate({ rules, action, context: context(kind) });
        expect(verdict.allowed, `${kind} ${operation}`).toBe(false);
        expect(verdict.rules.map((match) => match.id)).toContain('audit.entry.noWrites');
      }
    }
    expect(evaluateGate({ rules, action: get, context: context('operator') }).allowed).toBe(true);
  });
});

describe.each(['memory', 'pglite'] as const)(
  'who may write an audit entry, with an override that allows every action to operators on %s',
  (kind: AuditStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot() {
      const app = await bootAudit(overriddenAloneApp, kind);
      onTestFinished(() => app.runtime.stop());
      await app.client(adaUser).invoke('notes.note.create', { title: 'a' });
      await app.settle();
      return app;
    }

    test('create, update, archive and restore are refused to an operator and a tenant admin; reads answer', {
      timeout,
    }, async () => {
      const app = await boot();
      const [existing] = await app.entries();
      const id = String(existing?.id);
      const forged = {
        id: 'aud_forged',
        eventId: 'forged',
        eventType: 'x.y.z',
        streamType: 'x.y',
        streamId: '1',
        streamVersion: 1,
        at: auditBootedAt,
        actorKind: 'user',
        actorVia: 'v',
      };
      const calls: readonly (readonly [string, unknown])[] = [
        ['audit.entry.create', forged],
        ['audit.entry.update', { id, patch: { action: 'edited' } }],
        ['audit.entry.archive', { id }],
        ['audit.entry.restore', { id }],
      ];
      await app.seat();
      for (const client of [app.operator('acme'), app.client(adaUser)]) {
        for (const [action, input] of calls) {
          const refused = await client.attempt(action as never, input as never);
          expect(refused.ok, action).toBe(false);
        }
        const page = await client.attempt('audit.entry.query', {});
        expect(page.ok && app.own(page.value.items).length).toBe(1);
      }
      const operator = await app
        .operator('acme')
        .attempt('audit.entry.get', { ids: [id] as never });
      expect(operator.ok && operator.value.list).toHaveLength(1);
      const [after] = await app.entries();
      expect(after).toMatchObject({ id, eventType: 'notes.note.created' });
      expect(after?.action).toBe(existing?.action);
      expect(await app.entries()).toHaveLength(1);
    });

    test('two jobs of one event still end with one entry and every job succeeded', {
      timeout,
    }, async () => {
      const app = await bootAudit(overriddenAloneApp, kind);
      onTestFinished(() => app.runtime.stop());
      const jobs = holdReactionJobs(app.runtime.adapter);
      await app.client(adaUser).invoke('notes.note.create', { title: 'a' });
      await app.settle();
      const [original] = jobs.enqueued;
      if (original === undefined) throw new Error('no reaction job was queued');
      await app.runtime.adapter.unit(app.runtime.namespace, original.scope, async (unit) => {
        await unit.jobs.enqueue({ ...original, key: { value: 'second-copy', onConflict: 'keep' } });
      });
      const guard = blindDuplicateGuards(app.runtime.adapter, 2);
      jobs.release();
      await app.settle();
      expect(guard.lookups()).toBe(2);
      expect(await app.entries()).toHaveLength(1);
      expect(jobs.outcomes.filter((outcome) => outcome.kind === 'succeeded')).toHaveLength(
        jobs.outcomes.length,
      );
      expect(jobs.outcomes.length).toBeGreaterThanOrEqual(2);
    });

    test('a login writes exactly one entry', { timeout }, async () => {
      const app = await bootAudit(overriddenAccountsApp, kind);
      onTestFinished(() => app.runtime.stop());
      const signedUp = await app.request('auth.signUp', { ...person, displayName: 'Ada' });
      if (!signedUp.ok) throw signedUp.error;
      await app.settle();
      const before = await app.entries();
      const login = await app.request('auth.login', person);
      if (!login.ok) throw login.error;
      await app.settle();
      const entries = await app.entries();
      const logins = entries.filter((entry) => entry.eventType === 'auth.credential.loggedIn');
      expect(logins).toHaveLength(1);
      expect(entries.length).toBeGreaterThan(before.length);
      expect(new Set(entries.map((entry) => entry.eventId)).size).toBe(entries.length);
    });
  },
);
