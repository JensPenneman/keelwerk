import { describe, expect, test } from 'vitest';
import { diffSnapshots, renderMigrationFile, renderSnapshot, renderStep } from '../../src/index.ts';
import { goldenSnapshots } from './support/golden-entries.ts';
import { noRename } from './support/no-rename.ts';

const goldenName = (track: string): string =>
  track.replace('->', '-to-').replace('[', '-when-').replace(']', '');

const tracks = ['loans', 'loans->library', 'loans[library]', 'library'] as const;

describe('the stored formats are golden', () => {
  test.each(tracks)('the first migration file of %s', async (track) => {
    const snapshot = goldenSnapshots.get(track);
    if (snapshot === undefined) throw new Error(`no snapshot for ${track}`);
    const { steps } = await diffSnapshots(null, snapshot, noRename);
    const text = renderMigrationFile({ id: '0001-initial', track, steps });
    await expect(text).toMatchFileSnapshot(`./golden/${goldenName(track)}.migration.txt`);
  });

  test.each(tracks)('the snapshot of %s (keelwerk.snapshot/1)', async (track) => {
    const snapshot = goldenSnapshots.get(track);
    if (snapshot === undefined) throw new Error(`no snapshot for ${track}`);
    await expect(renderSnapshot(snapshot)).toMatchFileSnapshot(
      `./golden/${goldenName(track)}.snapshot.txt`,
    );
  });

  test('the PostgreSQL statements of the loans track', async () => {
    const snapshot = goldenSnapshots.get('loans');
    if (snapshot === undefined) throw new Error('no snapshot');
    const { steps } = await diffSnapshots(null, snapshot, noRename);
    const statements = steps.flatMap((step) => renderStep('golden', step, { role: 'kw_app' }));
    await expect(`${statements.map((sql) => `${sql};`).join('\n\n')}\n`).toMatchFileSnapshot(
      './golden/loans.sql',
    );
  });
});
