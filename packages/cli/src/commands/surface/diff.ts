import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { deriveApps } from '../../producers/derive-apps.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { findWorkspaceRoot } from '../doctor/find-workspace-root.ts';
import { baseFlag } from './base-flag.ts';
import { compareWithBase } from './compare-with-base.ts';
import { gitShow } from './git-show.ts';
import { surfaceFlags } from './surface-flags.ts';

/**
 * `surface diff [--base <ref>] [--app <id>]` (section 18.6): derives every API version of each app
 * and compares it with the surface the base committed, classifying each change as breaking,
 * dangerous, additive or neutral. A breaking change, a version removed above the floor or an edited
 * ledger entry exits 1.
 */
export const surfaceDiffCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Classify the changes to every API version against a git base.',
    fullDescription:
      'surface diff --base origin/main   breaking, dangerous, additive and neutral changes per app and version',
  },
  parameters: { flags: surfaceFlags(baseFlag) } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      const root = await findWorkspaceRoot(scoped.host);
      const base = typeof parsed.base === 'string' ? parsed.base : 'origin/main';
      const only = typeof parsed.app === 'string' ? parsed.app : undefined;
      const derived = await deriveApps(root);
      const report = await compareWithBase({
        root,
        apps: derived.apps.filter((app) => only === undefined || app.app.id === only),
        readBase: await gitShow(root, base),
      });
      const failures = [...derived.failures, ...report.failures];
      for (const note of [...derived.notes, ...report.notes]) scoped.output.note(note);
      for (const failure of failures) scoped.output.note(failure);
      if (scoped.output.format === 'text' || scoped.output.format === 'table') {
        for (const { app, version, change } of report.changes) {
          scoped.output.line(`${change.class} ${app} ${version} ${change.ref}: ${change.message}`);
        }
      } else {
        scoped.output.value({ base, changes: report.changes, failures, notes: report.notes });
      }
      if (failures.length > 0) scoped.process.exitCode = 1;
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
