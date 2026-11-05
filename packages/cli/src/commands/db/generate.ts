import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { planTrack } from '@keelwerk/data';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { renameAsk } from '../../db/rename-ask.ts';
import { targetOfTrack } from '../../db/target-of-track.ts';
import { writeTrackPlan } from '../../db/write-track-plan.ts';
import { deriveApps } from '../../producers/derive-apps.ts';
import { migrationTargets } from '../../producers/migration-targets.ts';
import { runProducersIsolated } from '../../producers/run-producers-isolated.ts';
import { shownPath } from '../../producers/shown-path.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { textFlag } from '../../routes/text-flag.ts';
import { findWorkspaceRoot } from '../doctor/find-workspace-root.ts';
import { dbFlags } from './db-flags.ts';

const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `db generate <track> --name <name> [--rename entity.from=to]` (section 14.6.4): writes the next
 * migration file of a track (and its contract file when the change has contract steps) and updates
 * the snapshot. When a field disappears and another of its kind appears in one entity, the planner
 * asks whether it is a rename; the answer goes into the file and the snapshot's rename history.
 */
export const dbGenerateCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string],
  CliContext
>({
  docs: {
    brief: 'Write the next migration file of a track.',
    fullDescription: 'db generate library --name add-isbn [--rename library.book.title=name]',
  },
  parameters: {
    flags: dbFlags({
      name: textFlag('The kebab-case name of the change: NNNN-<name>.', 'name'),
      rename: textFlag(
        'Answer a rename question: entity.from=to; repeatable.',
        'entity.from=to',
        true,
      ),
    }),
    positional: {
      kind: 'tuple',
      parameters: [
        {
          brief: 'The track, such as library or auth->accounts.',
          parse: String,
          placeholder: 'track',
        },
      ],
    },
  } as never,
  async func(this: CliContext, parsed, track: string) {
    const scoped = scopeOutput(this, parsed);
    try {
      const name = typeof parsed.name === 'string' ? parsed.name : undefined;
      if (name === undefined || !namePattern.test(name)) {
        throw usageFailure('db generate needs --name in kebab case, such as --name add-isbn.');
      }
      const root = await findWorkspaceRoot(scoped.host);
      const target = targetOfTrack(
        await migrationTargets(root, (await deriveApps(root)).apps, false),
        track,
      );
      const plan = await planTrack({
        previous: target.committed.snapshot,
        desired: target.desired,
        name,
        ask: renameAsk(scoped.host, (parsed.rename as readonly string[] | undefined) ?? []),
      });
      if (plan === null) {
        scoped.output.line(`${track} is up to date; nothing to generate`);
        return;
      }
      const moduleRoot = join(target.directory, '..', '..');
      const shipsMigrations = existsSync(join(moduleRoot, 'migrations'));
      for (const written of await writeTrackPlan(target.directory, plan)) {
        scoped.output.line(`create ${shownPath(root, join(target.directory, written))}`);
      }
      if (!shipsMigrations) {
        await runProducersIsolated({ root, check: false, only: ['manifests'] });
        scoped.output.line(`updated the manifest of ${target.module}: it now ships migrations`);
      }
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
