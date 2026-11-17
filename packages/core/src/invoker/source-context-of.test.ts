import { describe, expect, test, vi } from 'vitest';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { sourceContextOf } from './source-context-of.ts';

const built: string[] = [];
vi.mock('../interpreter/build-read-context.ts', () => ({
  buildReadContext: () => ({
    forModule: (id: string) => {
      built.push(id);
      return {};
    },
  }),
}));
vi.mock('../live/live-queries-of.ts', () => ({
  liveQueriesOf: (_registry: unknown, module: { readonly id: string }) => ({ module: module.id }),
}));

const registry = { modules: [{ id: 'dispatch' }, { id: 'peeker' }] } as unknown as Registry;

function contextOf(action: Pick<ActionEntry, 'module' | 'contributedBy'>) {
  built.length = 0;
  return sourceContextOf({ registry, action } as unknown as Parameters<typeof sourceContextOf>[0]);
}

describe('sourceContextOf', () => {
  test('a subscription of a module reads and follows as that module', () => {
    expect(contextOf({ module: 'dispatch' }).live).toEqual({ module: 'dispatch' });
    expect(built).toEqual(['dispatch']);
  });

  test('a contributed subscription reads and follows as its contributor, not as the module it is mounted under', () => {
    expect(contextOf({ module: 'dispatch', contributedBy: 'peeker' }).live).toEqual({
      module: 'peeker',
    });
    expect(built).toEqual(['peeker']);
  });
});
