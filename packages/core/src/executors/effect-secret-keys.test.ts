import { describe, expect, test } from 'vitest';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { effectSecretKeys } from './effect-secret-keys.ts';

const text = (keyId: string) => `kwv1.${keyId}.bm9uY2U.Y2lwaGVy`;

/** A unit whose keys open a text only under the binding the test names: key id to the member it is bound to. */
function unitOf(bound: Readonly<Record<string, string>>): { unit: Unit; asked: string[] } {
  const asked: string[] = [];
  const unit = {
    keys: {
      openValue: (
        sealed: { keyId: string },
        binding: { entity: string; id: string; field: string },
      ) => {
        asked.push(`${sealed.keyId}@${binding.entity}/${binding.id}/${binding.field}`);
        const opens = binding.entity === 'core.effect' && bound[sealed.keyId] === binding.field;
        return Promise.resolve(opens ? new Uint8Array() : undefined);
      },
    },
  } as unknown as Unit;
  return { unit, asked };
}

describe('effectSecretKeys', () => {
  test('finds the keys of a text, of the texts of a list or set and of lists in lists, from what is stored', async () => {
    const { unit } = unitOf({ k1: 'one', k2: 'many', k3: 'many', k4: 'many' });
    const row = {
      id: 'e1',
      input: { one: text('k1'), many: [text('k2'), [text('k3')], text('k4')], plain: 'hello' },
    } as unknown as StorageRow;
    expect([...(await effectSecretKeys(unit, row, 'input'))].sort()).toEqual([
      'k1',
      'k2',
      'k3',
      'k4',
    ]);
  });

  test('a text counts only when it opens under the binding of the member it sits in, the output under its own prefix', async () => {
    const { unit, asked } = unitOf({ k1: 'other', k2: 'output.seal' });
    const row = {
      id: 'e1',
      input: { one: text('k1') },
      output: { seal: text('k2'), ok: true },
    } as unknown as StorageRow;
    expect(await effectSecretKeys(unit, row, 'input')).toEqual([]);
    expect(await effectSecretKeys(unit, row, 'output')).toEqual(['k2']);
    expect(asked).toEqual(['k1@core.effect/e1/one', 'k2@core.effect/e1/output.seal']);
  });

  test('a row without that side names nothing', async () => {
    const { unit } = unitOf({});
    expect(await effectSecretKeys(unit, { id: 'e1' } as unknown as StorageRow, 'output')).toEqual(
      [],
    );
  });
});
