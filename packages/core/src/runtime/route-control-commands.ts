import { isControlCommand } from '../core-module/is-control-command.ts';
import type { CommandResult, CommandRunner } from '../invoker/command-runner.ts';
import type { ControlPath } from './control-path.ts';

/**
 * The command runner with the control commands routed to the runtime's control path (S-109):
 * `core.backend.create` and `core.tenant.create` run there under the session's principal and the
 * request's command id; every other command goes to `runner`.
 */
export function routeControlCommands(runner: CommandRunner, path: ControlPath): CommandRunner {
  return async (run) => {
    if (!isControlCommand(run.action.ref)) return runner(run);
    const who = {
      principal: run.session.principal,
      request: run.request,
      apiVersion: run.session.apiVersion,
      signal: run.signal,
      ...(run.invocation.commandId === undefined ? {} : { commandId: run.invocation.commandId }),
    };
    const input = run.input as Parameters<ControlPath['createBackend']>[0] &
      Parameters<ControlPath['createTenant']>[0];
    const created =
      run.action.ref === 'core.backend.create'
        ? await path.createBackend(input, who)
        : await path.createTenant(input, who);
    const result: CommandResult = {
      output: { id: created.id },
      ...(created.replayed ? { replayed: true } : {}),
    };
    return result;
  };
}
