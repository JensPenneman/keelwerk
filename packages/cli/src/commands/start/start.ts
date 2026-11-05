import type { ProcessRole } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { findDeploymentFile } from '../../context/find-deployment-file.ts';
import { localFailure } from '../../context/local-failure.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { loadDefinition } from '../../db/load-definition.ts';
import { jsonLogger } from '../../logging/json-logger.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { bootApp } from '../../serve/boot-app.ts';
import { startFlags } from './start-flags.ts';

/** The drain of the stop phase when the deployment names none (section 21.6). */
const drainMs = 60_000;

function roleOf(value: unknown): ProcessRole {
  return value === 'serve' || value === 'work' ? value : 'all';
}

/**
 * `start [--role serve|work|all] [--config <file>]` (section 16.9.7): runs one process of the
 * deployment the file describes, the way the compose file of `keelwerk init` does. Logs go to
 * standard output as JSON lines (section 11); an interrupt or `SIGTERM` starts the stop phase.
 */
export const startCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Run a process of the deployment.',
    fullDescription: [
      'start                       a process with role all from the deployment file of the project',
      'start --role serve          only the invocation protocol and the transports',
      'start --config <file>       a deployment file other than the nearest one',
    ].join('\n'),
  },
  parameters: { flags: startFlags() } as never,
  async func(this: CliContext, parsed) {
    try {
      const file = await findDeploymentFile(
        this.host,
        typeof parsed.config === 'string' ? parsed.config : undefined,
      );
      if (file === undefined) {
        throw usageFailure(
          'start found no deployment file: create keelwerk.config.ts or .launchway/deployment.ts, or pass --config.',
        );
      }
      const logger = jsonLogger(this.process.stdout, this.host.env.KEELWERK_LOG_LEVEL ?? 'info');
      const definition = await loadDefinition(file);
      const app = await bootApp(definition, {
        role: roleOf(parsed.role),
        environment: 'production',
        env: this.host.env,
        logger,
      }).catch((error: unknown) => {
        if (error instanceof KeelwerkError) {
          throw localFailure(error.kind, error.code, error.message);
        }
        throw error;
      });
      logger.info('listening', { port: app.port, operatorSocket: app.operatorSocket });
      if (!this.signal.aborted) {
        await new Promise<void>((resolve) => {
          this.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      await app.stop(drainMs);
    } catch (failure) {
      handleFailure(this, failure);
    }
  },
});
