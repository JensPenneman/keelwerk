import type { MigrationStep } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { buildTrackSnapshot, planTrack, renderStep } from '../../src/index.ts';
import { invocationEntry } from './support/invocation-entry.ts';
import { noRename } from './support/no-rename.ts';

async function createStepOf(): Promise<MigrationStep> {
  const desired = buildTrackSnapshot([invocationEntry()]).get('notes');
  if (desired === undefined) throw new Error('no notes track');
  const plan = await planTrack({ previous: null, desired, name: 'initial', ask: noRename });
  const step = plan?.files[0]?.steps.find((candidate) => candidate.op === 'createTable');
  if (step === undefined) throw new Error('no createTable step');
  return step;
}

describe('rendering the creation of an invocation table', () => {
  test('the policies are scoped on scope_id and maintenance covers every command', async () => {
    const text = renderStep('example', await createStepOf(), { role: 'kw_app' }).join(';\n');
    expect(text).toContain(
      'create policy scoped on "example".notes__stamp using (scope_id = coalesce(',
    );
    expect(text).toContain('with check (scope_id = coalesce(');
    expect(text).toMatch(
      /create policy maintenance on "example"\.notes__stamp using \(current_setting/,
    );
    expect(text).not.toContain('maintenance_select');
    expect(text).toContain('force row level security');
    expect(text).toContain(
      'grant select, insert, update, delete on "example"."notes__stamp" to "kw_app"',
    );
    // The tenant form of the policy names a column this table does not have (the setting `keelwerk.tenant_id` is not a column).
    expect(text).not.toMatch(/(?<!keelwerk\.)tenant_id/);
    expect(text).not.toContain('archived_at');
  });
});
