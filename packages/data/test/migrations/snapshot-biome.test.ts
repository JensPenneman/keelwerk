import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { renderSnapshot } from '../../src/index.ts';
import { goldenSnapshots } from './support/golden-entries.ts';

const root = resolve(import.meta.dirname, '../../../..');

describe('a rendered snapshot is stable under the formatter', () => {
  test.each([...goldenSnapshots.keys()])('Biome leaves the snapshot of %s unchanged', (track) => {
    const snapshot = goldenSnapshots.get(track);
    if (snapshot === undefined) throw new Error(`no snapshot for ${track}`);
    const text = renderSnapshot(snapshot);
    const result = spawnSync(
      resolve(root, 'node_modules/.bin/biome'),
      ['format', '--stdin-file-path=migrations/own/snapshot.json'],
      { cwd: root, input: text, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(text);
  });
});
