import { describe, expect, test, vi } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { defineApp } from '../dsl/define-app.ts';
import { createLiveEarlierShare } from '../live/create-live-earlier-share.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { earlierImagesOf } from './earlier-images-of.ts';
import { readableBefore } from './readable-before.ts';

const folds = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('./fold-stream.ts', () => ({
  foldStream: async (input: { id: string }) => {
    folds.ids.push(input.id);
    const row: StorageRow = { id: input.id, owner: 'ada', version: 1 } as unknown as StorageRow;
    return { row, kept: [{ position: 1n }], complete: true };
  },
}));

const { registry } = defineApp({ id: 'portal', modules: [accounts, auth] });
const entry = registry.entities.get('accounts.profile');
if (entry === undefined) throw new Error('the entity is in the registry');
const unit = {} as unknown as Unit;
const streams = ['p1', 'p2', 'p3', 'p4', 'p5'];

/** The 50 plan groups: each has its own `where`, none selects the streams asked about. */
const groups = Array.from({ length: 50 }, (_, at) => ({
  op: 'eq' as const,
  field: 'id',
  value: `p${at % 7}`,
}));

describe('readableBefore for many plan groups', () => {
  test('50 plan groups that ask about the same 5 streams cost 5 folds when they share the pass', async () => {
    folds.ids.length = 0;
    const share = createLiveEarlierShare();
    const since = 1n;
    const answers = [];
    for (const where of groups) {
      answers.push(
        await readableBefore({
          unit,
          registry,
          entry,
          since,
          where,
          ids: streams,
          skipArchived: false,
          images: earlierImagesOf(share, { unit, registry, entry, since }),
        }),
      );
    }
    expect(folds.ids).toHaveLength(5);
    expect(new Set(folds.ids)).toEqual(new Set(streams));
    // Each group still judges the shared rows by its own plan: only the groups naming p1 to p5 hold a row.
    expect(answers.map((answer) => answer.rows.size)).toEqual(
      groups.map((where) => (streams.includes(String(where.value)) ? 1 : 0)),
    );
    expect(answers.every((answer) => !answer.uncertain)).toBe(true);
  });

  test('without a share every group rebuilds the streams itself', async () => {
    folds.ids.length = 0;
    for (const where of groups) {
      await readableBefore({
        unit,
        registry,
        entry,
        since: 1n,
        where,
        ids: streams,
        skipArchived: false,
      });
    }
    expect(folds.ids).toHaveLength(250);
  });
});
