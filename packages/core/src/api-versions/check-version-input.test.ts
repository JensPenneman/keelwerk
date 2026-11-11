import { describe, expect, test } from 'vitest';
import { shelfApi, shelfApp } from '../../test/version-change-kit.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { applyVersionChanges } from './apply-version-changes.ts';
import { checkVersionInput } from './check-version-input.ts';

const { registry } = shelfApp();
const older = applyVersionChanges({ registry, api: shelfApi(), apiVersion: '2026-11-04' });

function action(ref: string): ActionEntry {
  const found = registry.actions.get(ref);
  if (found === undefined) throw new Error(`no action ${ref}`);
  return found;
}

describe('checkVersionInput', () => {
  test('names the older field in issues and refuses a member the version does not have', async () => {
    const create = action('shelf.item.create');
    await expect(checkVersionInput(older, create, { title: 'a' })).resolves.toBeUndefined();
    const refusal = async (input: unknown): Promise<KeelwerkError> => {
      try {
        await checkVersionInput(older, create, input);
      } catch (error) {
        return error as KeelwerkError;
      }
      throw new Error('did not refuse');
    };
    expect(await refusal({ title: 7 })).toMatchObject({
      kind: 'validation',
      code: 'core.validation',
      issues: [{ path: ['title'] }],
    });
    expect((await refusal({ label: 'a' })).issues).toContainEqual({
      path: ['label'],
      message: 'is not a field of this shape',
    });
    expect((await refusal({ title: 'a', size: 2 })).issues).toContainEqual({
      path: ['size'],
      message: 'is not a field of this shape',
    });
  });

  test('a patch issue names the older field in the nested path', async () => {
    const update = action('shelf.item.update');
    try {
      await checkVersionInput(older, update, { id: 'i', patch: { title: 4 } });
      expect.unreachable();
    } catch (error) {
      expect((error as KeelwerkError).kind).toBe('validation');
      expect((error as KeelwerkError).issues).toEqual([
        expect.objectContaining({ path: ['patch', 'title'] }),
      ]);
    }
  });

  test('a head name in a selection, a sort or a filter is refused with its path', async () => {
    const query = action('shelf.item.query');
    const issuesOf = async (action: ActionEntry, input: unknown): Promise<unknown> => {
      try {
        await checkVersionInput(older, action, input);
      } catch (error) {
        return (error as KeelwerkError).issues;
      }
      throw new Error('did not refuse');
    };
    const refused = (path: (string | number)[]) => [
      { path, message: 'is not a field of this shape' },
    ];
    expect(await issuesOf(query, { properties: ['title', 'label'] })).toEqual(
      refused(['properties', 1]),
    );
    expect(await issuesOf(query, { sort: [{ field: 'label' }] })).toEqual(
      refused(['sort', 0, 'field']),
    );
    expect(await issuesOf(query, { filter: { or: [{ title: 'a' }, { label: 'a' }] } })).toEqual(
      refused(['filter', 'or', 1, 'label']),
    );
    expect(
      await issuesOf(action('shelf.rack.query'), {
        filter: { items: { some: { label: 'a' } } },
      }),
    ).toEqual(refused(['filter', 'items', 'some', 'label']));
    await expect(
      checkVersionInput(older, query, { filter: { title: 'a' }, sort: [{ field: 'title' }] }),
    ).resolves.toBeUndefined();
  });

  test('the head, the code head and an untouched action check nothing extra', async () => {
    const head = applyVersionChanges({ registry, api: shelfApi(), apiVersion: '2026-11-11' });
    await expect(
      checkVersionInput(head, action('shelf.item.create'), { label: 'a' }),
    ).resolves.toBeUndefined();
  });
});
