import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { scratchCheck } from '../../db/scratch-check.ts';
import { deriveApps } from '../../producers/derive-apps.ts';
import { migrationTargets } from '../../producers/migration-targets.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { findWorkspaceRoot } from '../doctor/find-workspace-root.ts';
import { dbFlags } from './db-flags.ts';

/**
 * `db check` (sections 14.6.4 and 14.8.5): migrates a scratch PGlite database through the
 * committed files of each app's tracks and compares its catalogue with the committed snapshots:
 * missing or extra tables, columns, indexes and foreign keys, types, nullability, defaults and
 * row-level security policies. Exit 1 on any difference.
 */
export const dbCheckCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Migrate a scratch database and compare it with the snapshots.',
    fullDescription:
      'db check   runs every committed migration file on PGlite; no container is started',
  },
  parameters: { flags: dbFlags({}) } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      const root = await findWorkspaceRoot(scoped.host);
      const derived = await deriveApps(root);
      const targets = await migrationTargets(root, derived.apps, true);
      const results = [];
      for (const app of derived.apps) {
        const mine = targets.filter((target) => target.app === app.app.id);
        if (mine.length > 0) results.push(await scratchCheck(app.app.id, app.app.registry, mine));
      }
      const lines = results.flatMap((result) => [
        ...(result.failure === undefined ? [] : [`${result.app}: ${result.failure}`]),
        ...result.differences.map((difference) => `${result.app}: ${difference.detail}`),
      ]);
      if (scoped.output.format === 'text' || scoped.output.format === 'table') {
        for (const result of results) {
          if (result.failure === undefined && result.differences.length === 0) {
            scoped.output.line(`${result.app}: ${result.tracks.join(', ')} match their snapshots`);
          }
        }
        if (results.length === 0) scoped.output.line('no app ships migrations');
        for (const line of lines) scoped.output.note(line);
      } else {
        scoped.output.value(results);
      }
      if (lines.length > 0) scoped.process.exitCode = 1;
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
