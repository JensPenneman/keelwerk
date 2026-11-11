import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import { maxReactionDepth } from '../reactions/max-reaction-depth.ts';
import { reactionDepthError } from '../reactions/reaction-depth-error.ts';
import { authorizeInvoke } from './authorize-invoke.ts';
import { commandActionOf } from './command-action-of.ts';
import { commandJobRun } from './command-job-run.ts';
import { commandQueue } from './command-queue.ts';
import type { EffectScene } from './effect-scene.ts';
import { jobInput } from './job-input.ts';
import { sameScopeAction } from './same-scope-action.ts';
import { systemPrincipalOf } from './system-principal-of.ts';
import { validateEffectInput } from './validate-effect-input.ts';

/**
 * `invoke(action, input, { as?, prefer? })` (section 7.4): a command of the same scope. The
 * action's mode decides: a `sync` command runs in a savepoint of this unit after the decision's
 * events, so a failure rolls the savepoint back and fails the unit; an `async` one, or an `either`
 * one with `prefer: 'async'`, is enqueued with the unit. The result never returns to the decision;
 * only the ids of the deferred effects the invoked command requested come back, for the response.
 * The effect's derived id is the command id the invoked command runs under, so a repeated decision
 * invokes it under the same id. `as: system(reason)` runs it as the system principal, logged with
 * the reason; the default is the principal the decision acts as, checked by the gate.
 */
export async function runInvokeEffect(
  scene: EffectScene,
  effect: InvokeEffect,
  id: string,
): Promise<readonly string[]> {
  const { run, unit } = scene;
  const action = commandActionOf(run.registry, effect.action, 'invoke');
  sameScopeAction(run.scope, action, 'invoke');
  const principal =
    effect.as === undefined ? run.principal : systemPrincipalOf(effect.as.reason, run.principal);
  const input = validateEffectInput(action.input, effect.input, `"${action.ref}"`);
  authorizeInvoke({
    registry: run.registry,
    rules: run.rules,
    action,
    principal,
    scope: run.scope,
    input,
    flags: run.flags,
  });
  if (effect.as !== undefined) {
    run.log.info('a command runs as the system principal', {
      action: action.ref,
      reason: effect.as.reason,
      commandId: scene.commandId,
    });
  }
  const deferred =
    action.execution === 'async' || (action.execution === 'either' && effect.prefer === 'async');
  if (deferred) {
    await unit.jobs.enqueue({
      ...jobInput({
        actor: scene.causeActor,
        scope: run.scope,
        principal,
        causation: {
          commandId: scene.commandId,
          ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
        },
        build: run.build,
        now: scene.clock.now(),
      }),
      kind: 'action',
      queue: commandQueue,
      run: commandJobRun(action.ref, input, id),
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
  const result = await unit.nested((nested) =>
    scene.runNested(
      nested,
      { ...outer, action, input, principal },
      { commandId: id, depth: scene.depth + 1, causationId: scene.commandId },
    ),
  );
  return result.effects ?? [];
}
