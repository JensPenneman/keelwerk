import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import { maxReactionDepth } from '../reactions/max-reaction-depth.ts';
import { reactionDepthError } from '../reactions/reaction-depth-error.ts';
import { authorizeInvoke } from './authorize-invoke.ts';
import { checkEffectScope } from './check-effect-scope.ts';
import { checkInvokeErrors } from './check-invoke-errors.ts';
import { commandActionOf } from './command-action-of.ts';
import { commandJobRun } from './command-job-run.ts';
import { commandQueue } from './command-queue.ts';
import { crossScopeGroup } from './cross-scope-group.ts';
import type { EffectScene } from './effect-scene.ts';
import { jobInput } from './job-input.ts';
import { mapInvokeError } from './map-invoke-error.ts';
import { sealJobInput } from './seal-job-input.ts';
import { systemPrincipalOf } from './system-principal-of.ts';
import { validateEffectInput } from './validate-effect-input.ts';

/**
 * `invoke(action, input, { as?, prefer? })` (section 7.4): a command of the same scope, or a backend
 * command from a tenant unit (always deferred: the job stays in the tenant's unit and the invoker
 * runs it in the tenant's own backend unit; a system principal never crosses scopes, `checkEffectScope`).
 * The action's mode decides: a `sync` command runs in a savepoint of this unit after the decision's
 * events, so a failure rolls the savepoint back and fails the unit; an `async` one, or an `either`
 * one with `prefer: 'async'`, is enqueued with the unit. The result never returns to the decision;
 * only the ids of the deferred effects the invoked command requested come back, for the response.
 * The command id the invoked command runs under is the kernel form of the effect's derived id
 * (`kernelCommandId`), so a repeated decision invokes it under the same id. `as: system(reason)` runs it as the system principal, logged with
 * the reason; the default is the principal the decision acts as, checked by the gate. A failure of
 * the nested command whose code `errors` maps becomes the caller's declared error (`checkInvokeErrors`
 * refuses a map that cannot hold); the nested command's cause is the event a reaction decided on, else the command.
 */
export async function runInvokeEffect(
  scene: EffectScene,
  effect: InvokeEffect,
  id: string,
): Promise<readonly string[]> {
  const { run, unit } = scene;
  const action = commandActionOf(run.registry, effect.action, 'invoke');
  const principal =
    effect.as === undefined ? run.principal : systemPrincipalOf(effect.as.reason, run.principal);
  const placement = checkEffectScope(run.scope, action, 'invoke', principal);
  const input = validateEffectInput(action.input, effect.input, `"${action.ref}"`);
  authorizeInvoke({
    registry: run.registry,
    rules: run.rules,
    action,
    principal,
    scope: run.scope,
    input,
    flags: run.flags,
    caller: scene.module,
  });
  if (effect.as !== undefined) {
    run.log.info('a command runs as the system principal', {
      action: action.ref,
      reason: effect.as.reason,
      commandId: scene.commandId,
    });
  }
  const deferred =
    placement === 'backend' ||
    action.execution === 'async' ||
    (action.execution === 'either' && effect.prefer === 'async');
  checkInvokeErrors(effect, action, run.action, deferred);
  if (deferred) {
    const commandId = kernelCommandId('effect', id);
    await unit.jobs.enqueue({
      ...jobInput({
        actor: scene.causeActor,
        scope: run.scope,
        principal,
        caller: scene.module,
        action,
        causation: {
          commandId: scene.commandId,
          ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
        },
        build: run.build,
        now: scene.clock.now(),
      }),
      kind: 'action',
      queue: commandQueue,
      run: commandJobRun(action.ref, await sealJobInput(unit, commandId, action, input), commandId),
      ...(placement === 'backend' && run.scope.level === 'tenant'
        ? { group: crossScopeGroup(run.scope.backendId) }
        : {}),
    });
    return [];
  }
  if (action.prepare !== undefined) {
    throw refuseRequest(
      `invoke of "${action.ref}"`,
      'the command declares prepare, which runs outside a unit before the command begins',
    );
  }
  if (scene.depth >= maxReactionDepth) throw reactionDepthError(`The command "${action.ref}"`);
  // A nested command is no control path and has its own input to fingerprint.
  const {
    client: _client,
    commandId: _commandId,
    controlPath: _controlPath,
    fingerprintInput: _fingerprintInput,
    replayOnly: _replayOnly,
    ...outer
  } = run;
  // A nested command of a reaction is caused by the event the reaction decided on (D12).
  let result: Awaited<ReturnType<typeof scene.runNested>>;
  try {
    result = await unit.nested((nested) =>
      scene.runNested(
        nested,
        { ...outer, action, input, principal },
        {
          commandId: kernelCommandId('effect', id),
          depth: scene.depth + 1,
          causationId: scene.causeEventId ?? scene.commandId,
        },
      ),
    );
  } catch (error) {
    throw mapInvokeError(error, effect, run.action);
  }
  return result.effects ?? [];
}
