import { planTrack } from '@keelwerk/data';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { renderSteps } from '../../db/render-steps.ts';
import { targetOfTrack } from '../../db/target-of-track.ts';
import { deriveApps } from '../../producers/derive-apps.ts';
import { migrationTargets } from '../../producers/migration-targets.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { findWorkspaceRoot } from '../doctor/find-workspace-root.ts';
import { dbFlags } from './db-flags.ts';

/**
 * `db plan [track]` (section 14.6.4): shows, for each track whose definitions differ from its
 * snapshot, the files `db generate` would write and the PostgreSQL statements of their steps.
 * Nothing is written and no rename is assumed.
 */
export const dbPlanCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string?],
  CliContext
>({
  docs: {
    brief: 'Show the migration files the definitions call for.',
    fullDescription: 'db plan [track]   the steps and statements per track; writes nothing',
  },
  parameters: {
    flags: dbFlags({}),
    positional: {
      kind: 'tuple',
      parameters: [
        { brief: 'Only this track.', parse: String, placeholder: 'track', optional: true },
      ],
    },
  } as never,
  async func(this: CliContext, parsed, track?: string) {
    const scoped = scopeOutput(this, parsed);
    try {
      const root = await findWorkspaceRoot(scoped.host);
      const targets = await migrationTargets(root, (await deriveApps(root)).apps, false);
      const chosen = track === undefined ? targets : [targetOfTrack(targets, track)];
      const planned = [];
      for (const target of chosen) {
        const plan = await planTrack({
          previous: target.committed.snapshot,
          desired: target.desired,
          name: 'next',
          ask: async () => false,
        });
        if (plan === null) continue;
        planned.push({
          track: target.track,
          files: plan.files.map((file) => ({
            id: file.id,
            steps: file.steps,
            statements: renderSteps(target.app, file.steps),
          })),
        });
      }
      if (scoped.output.format === 'text' || scoped.output.format === 'table') {
        if (planned.length === 0) scoped.output.line('the definitions match every snapshot');
        for (const item of planned) {
          for (const file of item.files) {
            scoped.output.line(`${item.track} ${file.id}`);
            for (const statement of file.statements) scoped.output.line(`  ${statement}`);
          }
        }
      } else {
        scoped.output.value(planned);
      }
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
