import type { CliHost } from '../context/cli-host.ts';
import type { AppProcess } from './app-process.ts';
import { runCycle } from './dev-cycle.ts';
import { devPathsOf } from './dev-paths.ts';
import type { DevStatus } from './dev-status.ts';
import { statusLine } from './status-line.ts';
import { stopDeadlineMs } from './stop-deadline.ts';
import type { TypeChecker } from './type-checker-child.ts';
import { startTypeChecker } from './type-checker-child.ts';
import type { TypeCheckerCommand } from './type-checker-command.ts';
import { watchWorkspace } from './watch-workspace.ts';
import { writeDevDeployment } from './write-dev-deployment.ts';

/** What `keelwerk dev` is started with. */
export interface SupervisorInput {
  readonly host: CliHost;
  readonly root: string;
  /** The project's deployment file (`keelwerk.config.ts` or `.launchway/deployment.ts`). */
  readonly deploymentFile: string;
  /** Standard output and standard error of the command. */
  readonly print: (line: string) => void;
  readonly note: (line: string) => void;
  /** Ends the loop. */
  readonly signal: AbortSignal;
  /** The probe's import limit in milliseconds, the longest it may stay silent while a module import is in flight; default: 10 seconds (section 13.6). */
  readonly probeLimitMs?: number;
  /** The type checker's command; undefined: none runs. */
  readonly typeChecker: TypeCheckerCommand | undefined;
}

/**
 * The supervisor of section 13.6: starts the type checker, runs a cycle, and runs another after
 * every settled change until the signal aborts. Changes that arrive during a cycle run one more
 * cycle afterwards, never two at once.
 */
export async function runSupervisor(input: SupervisorInput): Promise<void> {
  const { host, signal } = input;
  const paths = devPathsOf(input.root);
  let status: DevStatus = {
    types: { kind: 'off' },
    app: 'starting',
    port: undefined,
    socket: undefined,
    restartMs: undefined,
  };
  const show = (next: Partial<DevStatus>): void => {
    status = { ...status, ...next };
    input.print(statusLine(status));
  };
  let app: AppProcess | undefined;
  let busy = false;
  let again = false;
  const cycle = async (): Promise<void> => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        show({ app: 'starting' });
        const previous = app;
        app = undefined;
        const outcome = await runCycle({
          host,
          paths,
          print: input.print,
          note: input.note,
          running: previous,
          ...(input.probeLimitMs === undefined ? {} : { probeLimitMs: input.probeLimitMs }),
        });
        app = outcome.kind === 'running' ? outcome.app : undefined;
        if (outcome.kind === 'running') {
          void outcome.app.exited.then(() => {
            if (app === outcome.app && !signal.aborted) {
              app = undefined;
              show({ app: 'failed' });
              input.note('the app exited; it starts again after the next change');
            }
          });
          if (outcome.ready.socket !== undefined) {
            await host.files.writeText(paths.socketRecord, `${outcome.ready.socket}\n`, 0o600);
          }
          show({
            app: 'running',
            port: outcome.ready.port,
            socket: outcome.ready.socket,
            restartMs: outcome.ms,
          });
        } else {
          show({ app: 'failed' });
        }
      } while (again && !signal.aborted);
    } finally {
      busy = false;
    }
  };
  await writeDevDeployment(host, paths, input.deploymentFile);
  const checker: TypeChecker | undefined =
    input.typeChecker === undefined
      ? undefined
      : startTypeChecker(host, input.root, input.typeChecker, input.note, (types) => {
          show({ types });
        });
  let loop: Promise<void> = Promise.resolve();
  const start = (): void => {
    loop = cycle().catch((failure: unknown) => {
      input.note(failure instanceof Error ? failure.message : String(failure));
    });
  };
  const watcher = watchWorkspace(
    host,
    input.root,
    () => {
      if (busy) again = true;
      else start();
    },
    (message) => input.note(`the file watcher failed, so changes may go unnoticed: ${message}`),
  );
  start();
  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
  watcher.close();
  await loop;
  await app?.stop(stopDeadlineMs);
  await checker?.stop();
}
