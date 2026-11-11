import { defineVersionChange, runChangeFixtures } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { versionedApp } from '../../src/fixtures/index.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { bootShelf, idOf, shelfAppOf, shelfChanges } from './support/shelf-kit.ts';

const old = '2026-11-04';
const head = '2026-11-11';
const ada = testPrincipal('ada');
const admin = testPrincipal('bea', { claims: { admin: true } });

describe('the roster at an older API version', () => {
  test('roster at 2026-11-04 sends and receives name, and the stored row holds displayName', async () => {
    const runtime = await startTestRuntime(versionedApp, { tenants: ['acme'] });
    try {
      const carrier = testCarrier(runtime.tenants.acme, ada);
      const call = (version: string, action: string, input: unknown) =>
        runtime.invoker.invoke<unknown, Record<string, unknown>>({
          action,
          input,
          carrier: { ...carrier, headers: { ...carrier.headers, 'keelwerk-version': version } },
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
          commandId: crypto.randomUUID(),
        });
      const created = await call(old, 'roster.contact.create', { name: 'Ada' });
      expect(created).toMatchObject({ ok: true, value: { name: 'Ada' } });
      expect(created.ok && created.value).not.toHaveProperty('displayName');
      const id = idOf(created);
      const atHead = await call(head, 'roster.contact.get', { ids: [id] });
      expect(atHead).toMatchObject({ ok: true, value: { list: [{ id, displayName: 'Ada' }] } });
      const atOld = await call(old, 'roster.contact.get', { ids: [id] });
      expect(atOld).toMatchObject({ ok: true, value: { list: [{ id, name: 'Ada' }] } });
      const refused = await call(old, 'roster.contact.create', { displayName: 'Ada' });
      expect(refused).toMatchObject({ ok: false, error: { kind: 'validation' } });
      expect(await call(head, 'roster.contact.create', { name: 'Ada' })).toMatchObject({
        ok: false,
        error: { kind: 'validation' },
      });
    } finally {
      await runtime.stop();
    }
  });

  test('the roster fixtures pass', async () => {
    expect(await runChangeFixtures(versionedApp.registry, versionedApp.api)).toEqual([]);
  });
});

describe('the four kinds of change over the kernel', () => {
  test('an older action ref answers at the older version only (S-163)', async () => {
    const { runtime, call } = await bootShelf();
    try {
      expect(await call(old, ada, 'shelf.place', {})).toMatchObject({
        ok: false,
        error: { kind: 'not_implemented' },
      });
      expect(await call(old, ada, 'shelf.put', {})).toMatchObject({
        ok: false,
        error: { code: 'shelf.no_room', kind: 'conflict' },
      });
      expect(await call(head, ada, 'shelf.put', {})).toMatchObject({
        ok: false,
        error: { kind: 'not_implemented' },
      });
      expect(await call(head, ada, 'shelf.place', {})).toMatchObject({
        ok: false,
        error: { code: 'shelf.full' },
      });
    } finally {
      await runtime.stop();
    }
  });

  test('required-added gets the default; removed is served by its transform', async () => {
    const { runtime, call } = await bootShelf();
    try {
      const created = await call(old, admin, 'shelf.item.create', { title: 'A', colour: 'red' });
      expect(created).toMatchObject({ ok: true, value: { title: 'A' } });
      expect(created.ok && created.value).not.toHaveProperty('size');
      const id = idOf(created);
      expect(await call(head, admin, 'shelf.item.get', { ids: [id] })).toMatchObject({
        value: { list: [{ label: 'A', size: 1 }] },
      });
      const served = await call(old, admin, 'shelf.item.get', { ids: [id] });
      expect(served).toMatchObject({ value: { list: [{ title: 'A', colour: 'grey' }] } });
      const queried = await call(old, admin, 'shelf.item.query', {});
      expect(queried).toMatchObject({
        value: { items: [{ title: 'A', $masked: ['colour'] }] },
      });
    } finally {
      await runtime.stop();
    }
  });

  test('filters, sorts and selections in older names select the same rows', async () => {
    const { runtime, call } = await bootShelf();
    try {
      for (const label of ['b', 'a', 'c']) {
        await call(head, admin, 'shelf.item.create', { label });
      }
      const older = await call(old, admin, 'shelf.item.query', {
        filter: { title: { in: ['a', 'c'] } },
        sort: [{ field: 'title', direction: 'desc' }],
        properties: ['title'],
      });
      const newer = await call(head, admin, 'shelf.item.query', {
        filter: { label: { in: ['a', 'c'] } },
        sort: [{ field: 'label', direction: 'desc' }],
        properties: ['label'],
      });
      const titles = (value: unknown, key: string) =>
        (value as { items: Record<string, unknown>[] }).items.map((row) => row[key]);
      expect(older.ok && titles(older.value, 'title')).toEqual(['c', 'a']);
      expect(newer.ok && titles(newer.value, 'label')).toEqual(['c', 'a']);
      expect(older.ok && older.value.items).not.toContainEqual(
        expect.objectContaining({ label: expect.anything() }),
      );
    } finally {
      await runtime.stop();
    }
  });

  test('a head name in a filter, a sort or a selection is refused at the older version', async () => {
    const { runtime, call } = await bootShelf();
    try {
      await call(head, admin, 'shelf.item.create', { label: 'a' });
      for (const input of [
        { filter: { label: 'a' } },
        { filter: { and: [{ not: { label: 'a' } }] } },
        { sort: [{ field: 'label' }] },
        { properties: ['label'] },
      ]) {
        expect(await call(old, admin, 'shelf.item.query', input)).toMatchObject({
          ok: false,
          error: { kind: 'validation', issues: [{ message: 'is not a field of this shape' }] },
        });
      }
      expect(await call(old, admin, 'shelf.item.query', { filter: { title: 'a' } })).toMatchObject({
        ok: true,
      });
    } finally {
      await runtime.stop();
    }
  });

  test('an accepted async command is stored and run at the head', async () => {
    const { runtime, call } = await bootShelf(undefined, true);
    try {
      const created = await call(head, admin, 'shelf.item.create', { label: 'early' });
      const id = idOf(created);
      const accepted = await call(
        old,
        ada,
        'shelf.item.restock',
        { id, title: 'late' },
        { prefer: 'async' },
      );
      expect(JSON.stringify(accepted)).toContain('accepted');
      expect(await runtime.drainJobs()).toBe(1);
      const rows = await call(head, admin, 'shelf.item.query', {});
      expect(rows).toMatchObject({ value: { items: [{ id, label: 'late' }] } });
    } finally {
      await runtime.stop();
    }
  });

  test('the issues of an error raised past the translation name the older fields', async () => {
    const { runtime, call } = await bootShelf();
    try {
      const id = idOf(await call(head, admin, 'shelf.item.create', { label: 'a' }));
      const paths = (outcome: Awaited<ReturnType<typeof call>>) =>
        outcome.ok ? [] : (outcome.error.issues ?? []).map((issue) => issue.path);
      const atOld = await call(old, ada, 'shelf.item.claim', { id, title: 'x' });
      expect(atOld).toMatchObject({ ok: false, error: { kind: 'validation' } });
      expect(paths(atOld)).toEqual([['title'], []]);
      const atHead = await call(head, ada, 'shelf.item.claim', { id, label: 'x', size: 2 });
      expect(paths(atHead)).toEqual([['label'], ['size']]);
    } finally {
      await runtime.stop();
    }
  });

  test('a replayed command answers in the version of the retry, the stored answer stays in head form', async () => {
    const { runtime, call } = await bootShelf();
    try {
      const commandId = crypto.randomUUID();
      const first = await call(old, admin, 'shelf.item.create', { title: 'A' }, { commandId });
      const again = await call(old, admin, 'shelf.item.create', { title: 'A' }, { commandId });
      expect(first).toMatchObject({ ok: true, value: { title: 'A' } });
      expect(again).toMatchObject({ ok: true, value: { id: idOf(first), title: 'A' } });
      expect(again.ok && again.value).not.toHaveProperty('label');
      const atHead = await call(head, admin, 'shelf.item.get', { ids: [idOf(first)] });
      expect(atHead).toMatchObject({ value: { list: [{ label: 'A' }] } });
    } finally {
      await runtime.stop();
    }
  });

  test('a renamed error code maps back', async () => {
    const { runtime, call } = await bootShelf();
    try {
      const atOld = await call(old, ada, 'shelf.put', {});
      expect(atOld).toMatchObject({
        ok: false,
        error: { code: 'shelf.no_room', kind: 'conflict' },
      });
      expect(atOld.ok === false && atOld.error.message).toBe('The shelf is full.');
      expect(await call(head, ada, 'shelf.place', {})).toMatchObject({
        error: { code: 'shelf.full' },
      });
    } finally {
      await runtime.stop();
    }
  });
});

describe('what a caller may not see stays hidden under the older names (C4)', () => {
  async function seeded() {
    const booted = await bootShelf();
    const created = await booted.call(head, admin, 'shelf.item.create', {
      label: 'a',
      note: 'secret',
    });
    return { ...booted, id: idOf(created) };
  }

  test('a masked field stays masked under its older name', async () => {
    const { runtime, call, id } = await seeded();
    try {
      const asHead = await call(head, ada, 'shelf.item.get', { ids: [id] });
      expect(asHead).toMatchObject({ value: { list: [{ label: 'a', $masked: ['note'] }] } });
      expect(JSON.stringify(asHead)).not.toContain('secret');
      const asOld = await call(old, ada, 'shelf.item.get', { ids: [id] });
      expect(asOld).toMatchObject({ value: { list: [{ title: 'a', $masked: ['memo'] }] } });
      expect(JSON.stringify(asOld)).not.toContain('secret');
      const row = asOld.ok ? (asOld.value.list as Record<string, unknown>[])[0] : undefined;
      expect(row).not.toHaveProperty('memo');
      expect(row).not.toHaveProperty('note');
      const admins = await call(old, admin, 'shelf.item.get', { ids: [id] });
      expect(admins).toMatchObject({ value: { list: [{ memo: 'secret' }] } });
    } finally {
      await runtime.stop();
    }
  });

  test('a caller who may not read a field cannot filter or sort by it under its older name either', async () => {
    const { runtime, call } = await seeded();
    try {
      const refused = async (version: string, name: string) => {
        const outcome = await call(version, ada, 'shelf.item.query', {
          filter: { [name]: 'secret' },
        });
        return outcome.ok ? 'allowed' : `${outcome.error.kind}:${outcome.error.code}`;
      };
      const sortRefused = async (version: string, name: string) => {
        const outcome = await call(version, ada, 'shelf.item.query', {
          sort: [{ field: name }],
        });
        return outcome.ok ? 'allowed' : `${outcome.error.kind}:${outcome.error.code}`;
      };
      expect(await refused(head, 'note')).not.toBe('allowed');
      expect(await refused(old, 'memo')).toBe(await refused(head, 'note'));
      expect(await sortRefused(head, 'note')).not.toBe('allowed');
      expect(await sortRefused(old, 'memo')).toBe(await sortRefused(head, 'note'));
      const selected = await call(old, ada, 'shelf.item.query', { properties: ['memo'] });
      expect(JSON.stringify(selected)).not.toContain('secret');
      const found = await call(old, admin, 'shelf.item.query', { filter: { memo: 'secret' } });
      expect(found).toMatchObject({ ok: true, value: { items: [{ title: 'a' }] } });
    } finally {
      await runtime.stop();
    }
  });
});

describe('a broken transform', () => {
  test('answers internal core.version_change_failed', async () => {
    const throwing = shelfChanges({
      broken: defineVersionChange(
        { id: 'shelf', version: '2.0.0' } as never,
        {
          since: '2.0.0',
          surface: [],
          input: {
            'shelf.item.create': () => {
              throw new Error('boom');
            },
          },
        } as never,
      ),
    });
    const { runtime, call } = await bootShelf(shelfAppOf(throwing, []));
    try {
      expect(await call(old, admin, 'shelf.item.create', { title: 'A' })).toMatchObject({
        ok: false,
        error: { kind: 'internal', code: 'core.version_change_failed' },
      });
    } finally {
      await runtime.stop();
    }
  });
});
