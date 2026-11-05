import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { findDeploymentFile } from '../../context/find-deployment-file.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { runSupervisor } from '../../dev/supervisor.ts';
import { typeCheckerCommand } from '../../dev/type-checker-command.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { findWorkspaceRoot } from '../doctor/find-workspace-root.ts';
import { devFlags } from './dev-flags.ts';

/**
 * `dev` (section 13.6): the type checker, the probe, the app on PGlite and the watch loop. Runs
 * until interrupted; every change to a source file regenerates what it must and restarts the app.
 */
export const devCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Run the project in development: type checker, generated files and the app on PGlite.',
    fullDescription: [
      'dev            type checker, probe, database synchronisation and the app; restarts on change',
      'dev --no-types leave the type checker out',
    ].join('\n'),
  },
  parameters: { flags: devFlags() } as never,
  async func(this: CliContext, parsed) {
    try {
      const deploymentFile = await findDeploymentFile(
        this.host,
        typeof parsed.config === 'string' ? parsed.config : undefined,
      );
      if (deploymentFile === undefined) {
        throw usageFailure(
          'dev runs a project and found no deployment file: create keelwerk.config.ts or .launchway/deployment.ts, or pass --config.',
        );
      }
      await runSupervisor({
        host: this.host,
        root: await findWorkspaceRoot(this.host),
        deploymentFile,
        print: (line) => this.output.line(line),
        note: (line) => this.output.note(line),
        signal: this.signal,
        typeChecker: parsed['no-types'] === true ? undefined : typeCheckerCommand,
      });
    } catch (failure) {
      handleFailure(this, failure);
    }
  },
});
