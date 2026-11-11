import { describe, expect, test, vi } from 'vitest';
import { user } from '../../test/invoker/invoker-kit.ts';
import { served, setup, tenant } from '../../test/invoker/live-kernel-kit.ts';
import type { StateToken } from '../events/state-token.ts';
import { createLiveEarlierShare } from '../live/create-live-earlier-share.ts';
import type { Unit } from '../storage/unit.ts';

/** How many snapshots of flags were built: one for each view the kernel builds. */
const snapshots = { count: 0 };

vi.mock('../flags/build-snapshot.ts', async (original) => {
  const real = await original<typeof import('../flags/build-snapshot.ts')>();
  return {
    buildSnapshot: (...args: Parameters<typeof real.buildSnapshot>) => {
      snapshots.count += 1;
      return real.buildSnapshot(...args);
    },
  };
});

describe('preparing a live view and the rules of its filter', () => {
  test('a live filter refuses what a query refuses: hidden fields, operators a personal field lacks, a short prefix', async () => {
    const { open, kernelOf } = setup({
      apps: new Map([
        ['notes-app', served],
        ['core', served],
      ]),
    });
    const session = open(user('ada'), '2026-11-04', tenant, 'notes-app');
    const kernel = kernelOf(session, 'notes.note');
    // A hidden personal field would give its plaintext away by bounds.
    await expect(kernel.view(session, { filter: { taxId: { gt: '5' } } })).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(kernel.view(session, { filter: { taxId: '123' } })).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(kernel.view(session, { filter: { email: { gt: 'a' } } })).rejects.toMatchObject({
      code: 'core.personal_operator',
    });
    await expect(
      kernel.view(session, { filter: { nick: { startsWith: 'ab' } } }),
    ).rejects.toMatchObject({ code: 'core.personal_needle_short' });
    await expect(
      kernel.view(session, { filter: { nick: { startsWith: 'abc' } } }),
    ).resolves.toBeDefined();
  });

  test("a live filter on a personal field compares with the field's normaliser", async () => {
    const { open, kernelOf } = setup({
      apps: new Map([
        ['notes-app', served],
        ['core', served],
      ]),
    });
    const session = open(user('ada'), '2026-11-04', tenant, 'notes-app');
    const view = await kernelOf(session, 'notes.note').view(session, {
      filter: { email: 'ADA@Example.BE' },
    });
    expect(view.inFilter({ id: 'n1', owner: 'ada', email: 'ada@example.be' })).toBe(true);
    expect(view.inFilter({ id: 'n2', owner: 'ada', email: 'bob@example.be' })).toBe(false);
  });

  test('the plan key of a principal with another role is another, that of the same role the same', async () => {
    const { open, kernelOf } = setup({
      apps: new Map([
        ['notes-app', served],
        ['core', served],
      ]),
    });
    const keyOf = async (roles: readonly string[]): Promise<string> => {
      const session = open({ ...user('ada'), roles } as never, '2026-11-04', tenant, 'notes-app');
      return (await kernelOf(session, 'notes.note').view(session, {})).planKey;
    };
    const plain = await keyOf([]);
    const viewer = await keyOf(['viewer']);
    expect(viewer).not.toBe(plain);
    expect(await keyOf(['viewer'])).toBe(viewer);
    // A role no rule reads does not split the group.
    expect(await keyOf(['other'])).toBe(plain);
  });

  test('view after prepare with the same input answers the prepared view once', async () => {
    const { open, kernelOf } = setup();
    const session = open(user('ada'));
    const kernel = kernelOf(session);
    const input = {};
    snapshots.count = 0;
    const prepared = await kernel.prepare(input, undefined);
    expect(snapshots.count).toBe(1);
    expect(await kernel.view(session, input)).toBe(prepared);
    expect(snapshots.count).toBe(1);
    // Answered once: the next view is a new one, and so is the view of another input object.
    const again = await kernel.view(session, input);
    expect(again).not.toBe(prepared);
    expect(snapshots.count).toBe(2);
    expect(await kernel.view(session, {})).not.toBe(prepared);
  });

  test("prepare checks the token's form and scope", async () => {
    const { open, kernelOf } = setup();
    const session = open(user('ada'));
    const kernel = kernelOf(session);
    const view = await kernel.view(session, {});
    await expect(kernel.prepare({}, 'nonsense' as StateToken)).rejects.toMatchObject({
      kind: 'validation',
      code: 'core.malformed_request',
    });
    const elsewhere = open(user('ada'), '2026-11-04', {
      level: 'tenant',
      backendId: 'b1',
      tenantId: 't9',
    });
    const foreign = (await kernelOf(elsewhere).view(elsewhere, {})).token(5n);
    await expect(kernel.prepare({}, foreign)).rejects.toMatchObject({
      code: 'core.token_scope_mismatch',
    });
    // A token of this scope passes, whatever its check: the check is judged when the stream starts.
    await expect(kernel.prepare({}, view.token(5n))).resolves.toBeDefined();
  });

  test('a token whose position was altered resynchronises like a forged one, and one of the first format too', async () => {
    const { open, kernelOf } = setup();
    const session = open(user('ada'));
    const view = await kernelOf(session).view(session, {});
    const token = view.token(50n);
    expect(view.judge(token, 100n)).toBe(50n);
    // The position goes back to 7: the replay would list rows hidden since, so the check refuses it.
    expect(view.judge(token.replace('.50.', '.7.') as StateToken, 100n)).toBe('resync');
    expect(
      view.judge(
        token.replace(/\.[0-9a-f]{32}$/, `.deadbeef${'0'.repeat(24)}`) as StateToken,
        100n,
      ),
    ).toBe('resync');
    expect(view.judge(token.replace('v2.', 'v1.') as StateToken, 100n)).toBe('resync');
  });

  test('a token of a watch without ids or fields does not resume one that names them, and an empty ids is not no ids', async () => {
    const { open, kernelOf } = setup();
    const session = open(user('ada'));
    const kernel = kernelOf(session);
    const open_ = await kernel.view(session, {});
    const none = await kernel.view(session, { ids: [] });
    const titles = await kernel.view(session, { fields: ['locale'] });
    const more = await kernel.view(session, { fields: ['locale', 'email'] });
    expect(open_.judge(none.token(5n), 10n)).toBe('resync');
    expect(none.judge(open_.token(5n), 10n)).toBe('resync');
    expect(open_.judge(titles.token(5n), 10n)).toBe('resync');
    expect(titles.judge(more.token(5n), 10n)).toBe('resync');
    expect(more.judge(more.token(5n), 10n)).toBe(5n);
  });
  test("the views of two plans fold each stream once between them, because the pass's share reaches the real earlier", async () => {
    const { open, kernelOf } = setup({
      apps: new Map([
        ['notes-app', served],
        ['core', served],
      ]),
    });
    const reads: string[] = [];
    const unit = {
      events: {
        readStream: (stream: { id: string }) => {
          reads.push(stream.id);
          return Promise.resolve([]);
        },
      },
    } as unknown as Unit;
    const viewOf = async (roles: readonly string[]) => {
      const session = open({ ...user('ada'), roles } as never, '2026-11-04', tenant, 'notes-app');
      return kernelOf(session, 'notes.note').view(session, {});
    };
    const plain = await viewOf([]);
    const viewer = await viewOf(['viewer']);
    expect(viewer.planKey).not.toBe(plain.planKey);
    const ids = ['n1', 'n2', 'n3', 'n4', 'n5'];
    const share = createLiveEarlierShare();
    await plain.earlier(unit, { since: 3n, ids, share });
    await viewer.earlier(unit, { since: 3n, ids, share });
    expect(reads).toHaveLength(5);
    // Without a share every call rebuilds the streams for itself.
    await viewer.earlier(unit, { since: 3n, ids });
    expect(reads).toHaveLength(10);
  });
});
