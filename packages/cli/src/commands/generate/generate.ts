import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { runProducersIsolated } from '../../producers/run-producers-isolated.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { findWorkspaceRoot } from '../doctor/find-workspace-root.ts';
import { generateFlags } from './generate-flags.ts';
import { generateOnly } from './generate-only.ts';

/**
 * `generate [--check] [--only <producer>]` (sections 13.7 and 16.9.7): writes every generated
 * artefact of the workspace (module manifests, the apps' generated files, surfaces and the ledger,
 * transport documents, the CLI manifest, first migration files) or, with `--check`, says which ones
 * have drifted and exits 1.
 */
export const generateCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Write or check the generated artefacts.',
    fullDescription: [
      "generate                  write the module manifests, the apps' generated files, the API surfaces and",
      '                          ledgers, the transport documents, the CLI manifests and first migration files',
      'generate --check          compare each with its sources; exit 1 on drift, write nothing',
      'generate --only cli,app   run named producers only (manifests, surfaces, app, openapi, cli, migrations)',
    ].join('\n'),
  },
  parameters: { flags: generateFlags() } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      if (parsed.watch === true) {
        throw usageFailure(
          'generate --watch is the watch loop of keelwerk dev, which this release does not ship yet.',
        );
      }
      const only = generateOnly(parsed.only as readonly string[] | undefined);
      const check = parsed.check === true;
      const result = await runProducersIsolated({
        root: await findWorkspaceRoot(scoped.host),
        check,
        ...(only === undefined ? {} : { only }),
      });
      for (const note of result.notes) scoped.output.note(note);
      for (const failure of result.failures) scoped.output.note(failure);
      if (scoped.output.format === 'text' || scoped.output.format === 'table') {
        for (const path of result.written) scoped.output.line(`${path} written`);
        if (result.written.length === 0 && result.failures.length === 0) {
          scoped.output.line(check ? 'every artefact is current' : 'every artefact is up to date');
        }
      } else {
        scoped.output.value(result);
      }
      if (result.failures.length > 0) scoped.process.exitCode = 1;
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
