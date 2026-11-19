import { isControlCommand } from '../core-module/is-control-command.ts';
import { checkCallerCommandId } from '../ids/check-caller-command-id.ts';
import type { CommandResult, CommandRunner } from '../invoker/command-runner.ts';
import type { ControlPath } from './control-path.ts';
import type { FlagTargetingCheck } from './flag-targeting-check.ts';
import type { QuotaCheck } from './quota-check.ts';

/**
 * The command runner with the control commands routed to the runtime's control path (S-109):
 * `core.backend.create` and `core.tenant.create` run there under the session's principal and the
 * request's command id. `core.flag.set` and `core.flag.restoreRules` are checked against the flag's
 * declaration first and then written as any command, and so is `core.quota.set` against the
 * backend's quota declarations (it stores the canonical limit the check answers); every other
 * command goes to `runner`.
 */
export function routeControlCommands(runner: CommandRunner, path: ControlPath): CommandRunner {
  return async (run) => {
    if (run.action.ref === 'core.flag.set') {
      await path.checkFlagTargeting(run.input as FlagTargetingCheck);
      return runner(run);
    }
    if (run.action.ref === 'core.flag.restoreRules') {
      const { id, ifVersion } = run.input as { readonly id: string; readonly ifVersion: number };
      await path.checkFlagRestore(id, ifVersion);
      return runner(run);
    }
    if (run.action.ref === 'core.quota.set') {
      const input = run.input as QuotaCheck;
      const limit = await path.checkQuota(input);
      // The row keeps the limit in its canonical form, never the friendly text the operator typed.
      // The mark tells the write path that the check ran: a nested invoke carries none.
      return runner({ ...run, input: { ...input, limit }, quotaChecked: true });
    }
    if (!isControlCommand(run.action.ref)) return runner(run);
    checkCallerCommandId(run.invocation.commandId);
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
