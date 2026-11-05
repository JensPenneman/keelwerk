import { readFileSync } from 'node:fs';
import type { EntityEntry } from '@keelwerk/core';
import { buildTrackSnapshot, planTrack, renderMigrationFile, renderSnapshot } from '@keelwerk/data';
import { describe, expect, test } from 'vitest';
import { libraryApp } from './index.ts';

function trackOfField(entry: EntityEntry, field: string): string {
  return entry.fieldTracks?.[field] ?? entry.tracks[0]?.track ?? entry.module;
}

describe('the library fixture migrations', () => {
  test('the committed files are what the planner plans for the track', async () => {
    const entries = [...libraryApp.registry.entities.values()];
    const desired = buildTrackSnapshot(entries, { trackOfField }).get('library');
    expect(desired).toBeDefined();
    if (desired === undefined) return;
    const plan = await planTrack({
      previous: null,
      desired,
      name: 'initial',
      ask: async () => false,
    });
    expect(plan).not.toBeNull();
    if (plan === null) return;
    const read = (name: string): string =>
      readFileSync(new URL(`modules/library/migrations/own/${name}`, import.meta.url), 'utf8');
    expect(read('snapshot.json')).toBe(renderSnapshot(plan.snapshot));
    for (const file of plan.files) expect(read(`${file.id}.ts`)).toBe(renderMigrationFile(file));
  });
});
