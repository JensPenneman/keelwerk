import process, { env } from 'node:process';
import { loadDefinition } from '../db/load-definition.ts';
import { jsonLogger } from '../logging/json-logger.ts';
import { bootApp } from '../serve/boot-app.ts';
import { devEnvOf } from './dev-env.ts';
import { devPathsOf } from './dev-paths.ts';
import { readyMarker } from './ready-marker.ts';

/** What the app child is given. */
export interface AppOptions {
  readonly root: string;
  readonly deployment: string;
  /** Milliseconds the stop phase may take. */
  readonly stopDeadlineMs: number;
}

/**
 * The app (section 13.6): one process with role `all`, the dev operator socket, the explain stream
 * and the source condition of the child. Prints one ready line, then serves until `SIGTERM` or
 * `SIGINT`, drains within the deadline and returns.
 */
export async function runApp(options: AppOptions): Promise<void> {
  const definition = await loadDefinition(options.deployment);
  const paths = devPathsOf(options.root);
  const runEnv = devEnvOf(definition, env, paths);
  const app = await bootApp(definition, {
    role: 'all',
    environment: 'development',
    env: runEnv,
    logger: jsonLogger(process.stdout, 'info'),
  });
  const stopped = new Promise<void>((resolve) => {
    // The terminal sends the child SIGINT and the supervisor sends SIGTERM: one stop serves both.
    let stopping: Promise<void> | undefined;
    const stop = (): void => {
      stopping ??= app.stop(options.stopDeadlineMs);
      stopping.then(resolve, resolve);
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
  process.stdout.write(
    `${readyMarker} ${JSON.stringify({ port: app.port, socket: app.operatorSocket })}\n`,
  );
  await stopped;
}
