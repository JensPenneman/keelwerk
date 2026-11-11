import { describe, expect, test } from 'vitest';
import { user } from '../../test/invoker/invoker-kit.ts';
import {
  entity,
  operator,
  registry,
  served,
  setup,
  tenant,
} from '../../test/invoker/live-kernel-kit.ts';
import { readFilter } from '../generated-actions/read-filter.ts';
import { liveKernelOf } from '../live/live-kernel-of.ts';
import type { Principal } from '../principals/principal.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { issueStateToken } from '../tokens/issue-state-token.ts';
import { stateTokenKey } from '../tokens/state-token-key.ts';
import type { InvocationSession } from './invocation-session.ts';

describe('the live kernel and its views', () => {
  test('inPlan over 30 rows asks rows.matching once per quantifier node', async () => {
    const { open, kernelOf, matching } = setup();
    const session = open(user('ada'));
    const view = await kernelOf(session).view(session, {});
    const rows: StorageRow[] = Array.from({ length: 30 }, (_, at) => ({ id: `p${at}` }));
    const unit = (await kernelOf(session).read(async (one) => one, { timeoutMs: 1000 })) as never;
    const answers = await view.inPlan(unit, rows);
    expect(answers).toHaveLength(30);
    expect(answers.filter(Boolean)).toHaveLength(15);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.ids).toHaveLength(30);
    expect(matching[0]?.relation).toBe('credentials');
  });

  test('equal plans give equal planKeys, another subject or kind of principal another', async () => {
    const { open, kernelOf } = setup();
    const keyOf = async (principal: Principal): Promise<string> => {
      const session = open(principal);
      return (await kernelOf(session).view(session, {})).planKey;
    };
    const ada = await keyOf(user('ada'));
    expect(await keyOf(user('ada'))).toBe(ada);
    expect(ada).toMatch(/^[0-9a-f]{64}$/);
    expect(await keyOf(user('bob'))).not.toBe(ada);
    expect(await keyOf(operator())).not.toBe(ada);
  });

  test('a filter with a relation quantifier is unsupported', async () => {
    const { open, kernelOf } = setup();
    const session = open(user('ada'));
    await expect(
      kernelOf(session).view(session, { filter: { credentials: { some: { kind: 'password' } } } }),
    ).rejects.toMatchObject({ kind: 'unsupported' });
  });

  test('a filter on a hidden field is forbidden', async () => {
    const { open, kernelOf } = setup({
      apps: new Map([
        ['notes-app', served],
        ['core', served],
      ]),
    });
    const session = open(user('ada'), '2026-11-04', tenant, 'notes-app');
    await expect(
      kernelOf(session, 'notes.note').view(session, { filter: { secret: 'x' } }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    // A field the rule reveals may be filtered by.
    await expect(
      kernelOf(session, 'notes.note').view(session, { filter: { owner: 'ada' } }),
    ).resolves.toBeDefined();
  });

  test('view of a session of another tenant is internal', async () => {
    const { open, kernelOf } = setup();
    const mine = open(user('ada'));
    const other = open(user('ada'), '2026-11-04', {
      level: 'tenant',
      backendId: 'b1',
      tenantId: 't2',
    });
    await expect(kernelOf(mine).view(other, {})).rejects.toMatchObject({ kind: 'internal' });
    const stranger = { ...mine } as InvocationSession;
    await expect(kernelOf(mine).view(stranger, {})).rejects.toMatchObject({ kind: 'internal' });
  });

  test('judge: malformed, other scope, other principal, ids, apiVersion or epoch, a position past the head', async () => {
    const { open, kernelOf } = setup();
    const session = open(user('ada'));
    const view = await kernelOf(session).view(session, {});
    const token = view.token(5n);
    expect(view.judge(token, 10n)).toBe(5n);
    // A token that is not one, and one of another scope.
    expect(() => view.judge('nonsense', 10n)).toThrow(
      expect.objectContaining({ kind: 'validation', code: 'core.malformed_request' }),
    );
    const elsewhere = open(user('ada'), '2026-11-04', {
      level: 'tenant',
      backendId: 'b1',
      tenantId: 't9',
    });
    const foreign = await kernelOf(elsewhere).view(elsewhere, {});
    expect(() => view.judge(foreign.token(5n), 10n)).toThrow(
      expect.objectContaining({ kind: 'validation', code: 'core.token_scope_mismatch' }),
    );
    // Another principal, other ids, another API version, another epoch: resynchronise.
    const bob = open(user('bob'));
    expect(view.judge((await kernelOf(bob).view(bob, {})).token(5n), 10n)).toBe('resync');
    const narrowed = await kernelOf(session).view(session, { ids: ['a'] });
    expect(view.judge(narrowed.token(5n), 10n)).toBe('resync');
    const newer = open(user('ada'), '2026-11-11');
    expect(view.judge((await kernelOf(newer).view(newer, {})).token(5n), 10n)).toBe('resync');
    const later = setup({ epochOf: () => 1 });
    const fresh = later.open(user('ada'));
    expect(view.judge((await later.kernelOf(fresh).view(fresh, {})).token(5n), 10n)).toBe('resync');
    // A position past the head.
    expect(view.judge(view.token(50n), 10n)).toBe('resync');
  });

  test('a get state and a query queryState with the default sort resume, a stream token of another filter does not', async () => {
    const { env, open, kernelOf } = setup();
    const session = open(user('ada'));
    const view = await kernelOf(session).view(session, {});
    const context = {
      registry,
      rules: env.rulesOf(registry),
      principal: session.principal,
      epoch: 0,
      sealKey: await stateTokenKey(env.options.keys, tenant),
    };
    const entry = registry.entities.get(entity);
    if (entry === undefined) throw new Error('the entity is in the registry');
    const state = issueStateToken(context, entity, tenant, 7n, {});
    expect(view.judge(state, 10n)).toBe(7n);
    const queryState = issueStateToken(context, entity, tenant, 8n, {
      query: { filter: undefined, sort: entry.page.defaultSort },
    });
    expect(view.judge(queryState, 10n)).toBe(8n);
    const filtered = await kernelOf(session).view(session, { filter: { locale: 'nl' } });
    expect(view.judge(filtered.token(5n), 10n)).toBe('resync');
    expect(filtered.judge(filtered.token(5n), 10n)).toBe(5n);
  });

  test('a filtered view accepts the plain state of a get and the queryState of the same filter', async () => {
    const { env, open, kernelOf } = setup();
    const session = open(user('ada'));
    const filtered = await kernelOf(session).view(session, { filter: { locale: 'nl' } });
    const context = {
      registry,
      rules: env.rulesOf(registry),
      principal: session.principal,
      epoch: 0,
      sealKey: await stateTokenKey(env.options.keys, tenant),
    };
    const entry = registry.entities.get(entity);
    if (entry === undefined) throw new Error('the entity is in the registry');
    // What `get` and `changes` answer carries no filter: a watch with a filter still resumes from it.
    expect(filtered.judge(issueStateToken(context, entity, tenant, 7n, {}), 10n)).toBe(7n);
    const queryState = issueStateToken(context, entity, tenant, 8n, {
      query: { filter: readFilter({ locale: 'nl' }), sort: entry.page.defaultSort },
    });
    expect(filtered.judge(queryState, 10n)).toBe(8n);
    const otherFilter = issueStateToken(context, entity, tenant, 9n, {
      query: { filter: readFilter({ locale: 'fr' }), sort: entry.page.defaultSort },
    });
    expect(filtered.judge(otherFilter, 10n)).toBe('resync');
  });

  test('liveKernelOf without routeSubscribe is internal', () => {
    const { open } = setup();
    const session = open(user('ada'));
    expect(() => liveKernelOf(session, entity)).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
  });
});
