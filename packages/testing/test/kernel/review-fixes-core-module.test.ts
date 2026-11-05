import type { DataAdapter, DataAdapterFactory, NamespaceRef, StorageScope } from '@keelwerk/core';
import {
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  relation,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import {
  bearer,
  call,
  local,
  ok,
  operatorHost,
  probe,
  testClock,
} from './support/core-actions-kit.ts';
import { ada, boot, deploymentOf, factoryOf, type Kind } from './support/runtime-kit.ts';

const kinds: readonly Kind[] = ['memory', 'pglite'];

/** The factory of the kind, remembering where the control store's deployment scope lives. */
function watched(kind: Kind) {
  const base: DataAdapterFactory = factoryOf(kind);
  let found: { adapter: DataAdapter; namespace: NamespaceRef; scope: StorageScope } | undefined;
  const factory: DataAdapterFactory = {
    ...base,
    create: (placement, env) => {
      const adapter = base.create(placement, env);
      const open = adapter.unit.bind(adapter);
      adapter.unit = (namespace, scope, fn, options) => {
        if (scope.level === 'deployment') found = { adapter, namespace, scope };
        return open(namespace, scope, fn, options);
      };
      return adapter;
    },
  };
  const control = () => {
    if (found === undefined) throw new Error('the control store was not opened');
    return found;
  };
  return {
    factory,
    receipt: (commandId: string) => {
      const { adapter, namespace, scope } = control();
      return adapter.unit(namespace, scope, (unit) => unit.receipts.get(commandId));
    },
  };
}

function issue(runtime: Awaited<ReturnType<typeof boot>>, commandId: string, label = 'laptop') {
  return runtime.invoker.invoke<unknown, { id: string; token: string }>({
    action: 'core.operatorToken.issue',
    input: { label },
    carrier: local,
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
    commandId,
  });
}

describe.each(kinds)('operator tokens on %s: shown once and the unit keys', (kind) => {
  test('the stored receipt never holds the token, and a replay answers conflict', {
    timeout: 60_000,
  }, async () => {
    const spy = watched(kind);
    const runtime = await boot(
      deploymentOf(kind, { operator: { hosts: [operatorHost] }, factory: spy.factory }),
      { clock: testClock().clock },
    );
    const first = await issue(runtime, 'issue-1');
    if (!first.ok) throw first.error;
    const secretPart = first.value.token.split('_')[2] ?? '?';
    const receipt = await spy.receipt('issue-1');
    expect(receipt?.status).toBe('completed');
    expect(JSON.stringify(receipt)).not.toContain(secretPart);
    expect(JSON.stringify(receipt)).not.toContain(first.value.token);
    const again = await issue(runtime, 'issue-1');
    expect(again).toMatchObject({ ok: false, error: { kind: 'conflict' } });
    // A new command issues a new token.
    const second = await issue(runtime, 'issue-2');
    expect(second).toMatchObject({ ok: true });
  });

  test('parallel issues leave one deployment key: every token verifies', {
    timeout: 60_000,
  }, async () => {
    const runtime = await boot(deploymentOf(kind, { operator: { hosts: [operatorHost] } }), {
      clock: testClock().clock,
    });
    const outcomes = await Promise.all(
      ['a', 'b', 'c'].map((label) => issue(runtime, `p-${label}`, label)),
    );
    for (const outcome of outcomes) {
      if (!outcome.ok) throw outcome.error;
      const probed = await call(runtime.invoker, bearer(outcome.value.token), probe);
      expect(probed).toMatchObject({ ok: true });
    }
  });
});

describe.each(kinds)('generated updates of the core entities on %s', (kind) => {
  test('set and update refuse placement members and pins; setApiVersion owns the pin', {
    timeout: 60_000,
  }, async () => {
    const runtime = await boot(deploymentOf(kind), { clock: testClock().clock });
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    const setPatch = (patch: Record<string, unknown>) =>
      call(runtime.invoker, local, 'core.tenant.set', {
        update: [{ id: tenant.id, patch }],
      });
    expect(await setPatch({ backendId: 'other' })).toMatchObject({
      ok: false,
      error: { kind: 'not_implemented' },
    });
    expect(await setPatch({ placement: 'other' })).toMatchObject({
      ok: false,
      error: { kind: 'not_implemented' },
    });
    expect(await setPatch({ apiVersion: '2026-11-04' })).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
    expect(
      await call(runtime.invoker, local, 'core.tenant.update', {
        id: tenant.id,
        apiVersion: '2026-11-04',
      }),
    ).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(
      await call(runtime.invoker, local, 'core.backend.set', {
        update: [{ id: backend.id, patch: { app: 'other' } }],
      }),
    ).toMatchObject({ ok: false, error: { kind: 'not_implemented' } });
    expect(
      await call(runtime.invoker, local, 'core.backend.set', {
        update: [{ id: backend.id, patch: { apiVersion: '2026-11-04' } }],
      }),
    ).toMatchObject({ ok: false, error: { kind: 'validation' } });
    const pinned = await call(runtime.invoker, local, 'core.tenant.setApiVersion', {
      id: tenant.id,
      apiVersion: '2026-11-04',
    });
    expect(pinned).toMatchObject({ ok: true });
  });

  test('a create of a tenant or backend over the invoker goes through the control path, which checks the catalogue; Runtime.control works too', {
    timeout: 60_000,
  }, async () => {
    const runtime = await boot(deploymentOf(kind), { clock: testClock().clock });
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    expect(
      await call(runtime.invoker, local, 'core.tenant.create', {
        backendId: backend.id,
        name: 'ghost',
        domains: [],
        placement: 'nowhere',
        apiVersion: '1999-01-01',
      }),
    ).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(
      await call(runtime.invoker, local, 'core.backend.create', {
        name: 'ghost',
        app: 'unserved',
        placement: 'nowhere',
      }),
    ).toMatchObject({ ok: false, error: { kind: 'validation' } });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    expect(tenant.id).toBeTruthy();
  });
});

const post = defineEntity({ prefix: 'post', fields: { open: field.boolean().index() } });
const note = defineEntity({
  prefix: 'note',
  fields: {
    postId: field.ref.own('post').index(),
    title: field.string(),
    tags: field.set(field.string()),
  },
  relations: { post: relation.one.own('post', { by: 'id', to: 'postId' }) },
});
const base = defineModuleBase({ id: 'wall', version: '0.1.0', entities: { post, note } });
const wall = defineModule(base, {
  policies: {
    post: {
      all: defineRule(base, post, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
      }),
    },
    note: {
      write: defineRule(base, note, { effect: 'allow', actions: ['write'], principal: 'user' }),
      // The seeding subject reads what it writes, the note on a closed post included (8.4).
      seed: defineRule(base, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.principal.claims.seed === true ? {} : false),
      }),
      open: defineRule(base, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: () => ({ post: { is: { open: true } } }),
      }),
      notClosed: defineRule(base, note, {
        effect: 'allow',
        actions: ['get'],
        principal: 'user',
        where: () => ({ not: { post: { is: { open: false } } } }),
      }),
      noClosed: defineRule(base, note, {
        effect: 'deny',
        actions: ['update'],
        principal: 'user',
        reason: 'closed posts are frozen',
        where: () => ({ post: { is: { open: false } } }),
      }),
      mentions: defineRule(base, note, {
        effect: 'allow',
        actions: ['archive'],
        principal: 'user',
        where: () => ({ title: { contains: 'draft' } }),
      }),
      tagged: defineRule(base, note, {
        effect: 'allow',
        actions: ['restore'],
        principal: 'user',
        where: () => ({ tags: { contains: 'blue' } }),
      }),
    },
  },
});
const wallApp = withTestResolver(defineApp({ id: 'wall-app', modules: [wall] }));

describe.each(kinds)('core.me over relation quantifiers on %s', (kind) => {
  test('an allow rule resolves the ids of its own tenant; not and deny stay with the server', {
    timeout: 60_000,
  }, async () => {
    const runtime = await boot(deploymentOf(kind, { apps: [wallApp] }), {
      clock: testClock().clock,
    });
    const backend = await runtime.control.createBackend({
      name: 'wall',
      app: 'wall-app',
      placement: 'main',
    });
    const acme = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    const globex = await runtime.control.createTenant({ backendId: backend.id, name: 'globex' });
    const as = (tenant: { id: string }, name: string) => testCarrier({ name, id: tenant.id }, ada);
    const seeder = testPrincipal('seeder', { claims: { seed: true } });
    const make = async (tenant: { id: string }, name: string, open: boolean) => {
      const seeded = testCarrier({ name, id: tenant.id }, seeder);
      const created = await ok(call(runtime.invoker, seeded, 'wall.post.create', { open }));
      const id = String(created.id);
      const item = await ok(
        call(runtime.invoker, seeded, 'wall.note.create', {
          postId: id,
          title: 'a draft',
          tags: ['blue'],
        }),
      );
      return String(item.id);
    };
    const acmeNote = await make(acme, 'acme', true);
    const globexNote = await make(globex, 'globex', true);
    await make(acme, 'acme', false);
    const me = await ok(call(runtime.invoker, as(acme, 'acme'), 'core.me'));
    const rules = me.rules as {
      action: string[];
      subject: string;
      inverted?: true;
      serverOnly?: true;
      conditions?: Record<string, unknown>;
    }[];
    const notes = rules.filter((rule) => rule.subject === 'wall.note');
    const open = notes.find((rule) => rule.action.includes('read'));
    expect(open?.conditions).toEqual({ id: { $in: [acmeNote] } });
    expect(JSON.stringify(open)).not.toContain(globexNote);
    expect(
      notes.find((rule) => rule.action.length === 1 && rule.action[0] === 'get'),
    ).toMatchObject({ serverOnly: true });
    const denied = notes.find((rule) => rule.inverted === true);
    expect(denied).toMatchObject({ serverOnly: true, action: ['update'] });
    expect(denied).not.toHaveProperty('conditions');
    expect(notes.find((rule) => rule.action.includes('archive'))?.conditions).toEqual({
      title: { $regex: 'draft' },
    });
    expect(notes.find((rule) => rule.action.includes('restore'))?.conditions).toEqual({
      tags: 'blue',
    });
    // The rules list the expanded action names, never the raw aliases.
    expect(notes.every((rule) => !rule.action.includes('write'))).toBe(true);
  });
});
