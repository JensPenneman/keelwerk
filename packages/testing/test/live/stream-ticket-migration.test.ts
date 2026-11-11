import { readFileSync } from 'node:fs';
import { defineApp, type EntityEntry } from '@keelwerk/core';
import {
  buildTrackSnapshot,
  planTrack,
  renderMigrationFile,
  renderSnapshot,
  renderStep,
} from '@keelwerk/data';
import { live } from '@keelwerk/live';
import { describe, expect, test } from 'vitest';

function trackOfField(entry: EntityEntry, field: string): string {
  return entry.fieldTracks?.[field] ?? entry.tracks[0]?.track ?? entry.module;
}

const read = (name: string): string =>
  readFileSync(new URL(`../../../live/migrations/own/${name}`, import.meta.url), 'utf8');

describe('the live module migrations', () => {
  test('the committed files are what the planner plans for track live', async () => {
    const app = defineApp({ id: 'live-only', modules: [live] });
    const desired = buildTrackSnapshot([...app.registry.entities.values()], { trackOfField }).get(
      'live',
    );
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
    expect(plan.files).toHaveLength(1);
    const [initial] = plan.files;
    if (initial === undefined) return;
    expect(read('0001-initial.ts')).toBe(renderMigrationFile(initial));
    expect(read('snapshot.json')).toBe(renderSnapshot(plan.snapshot));
  });

  test('the stored form of a ticket keeps a verifier and no secret, and the table is the planner’s', () => {
    const text = read('0001-initial.ts');
    expect(text).toContain("name: 'live__stream_ticket'");
    expect(text).toContain("name: 'verifier'");
    expect(text).toContain("name: 'public_id'");
    expect(text).toContain("name: 'used_at'");
    expect(text).not.toMatch(/secret|token|plain/);
  });

  test('the table the planner creates for a ticket is an invocation table, pinned as SQL', async () => {
    const file = JSON.parse(read('snapshot.json')) as { tables: { name: string }[] };
    expect(file.tables.map((table) => table.name)).toEqual(['live__stream_ticket']);
    const { migration } = await import('../../../live/migrations/own/0001-initial.ts');
    const step = migration.steps.find((candidate) => candidate.op === 'createTable');
    if (step === undefined) throw new Error('the migration creates no table');
    const text = renderStep('example', step, { role: 'keelwerk_app' }).join(';\n');
    // A ticket lives in the scope of the session that issued it: the scope column, no tenant column, no archive, no chain.
    expect(text).toContain('scope_id');
    expect(text).not.toMatch(/(?<!keelwerk\.)tenant_id/);
    expect(text).not.toContain('archived_at');
    expect(text).not.toContain('kw_');
    await expect(`${text}\n`).toMatchFileSnapshot('./stream-ticket-0001.sql');
  });
});
