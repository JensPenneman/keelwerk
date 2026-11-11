import { createAbility } from '../authorization/create-ability.ts';
import { forbiddenError } from '../authorization/forbidden-error.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { AskRequest } from '../protocol/ask-request.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import type { AnswerDeps } from './answer-deps.ts';
import { authorityOf } from './authority-of.ts';
import { dispatchRequest } from './dispatch-request.ts';
import { driveHandler } from './drive-handler.ts';
import { principalContextOf } from './principal-context-of.ts';
import { refuseRequest } from './refuse-request.ts';

/**
 * Answers `ctx.ask(ref, input)` (section 7.9.3): a dependency's query action runs inside the unit,
 * gated as the current principal, with its own module's context. A backend-scope query asked from
 * a tenant unit runs in its own read-only snapshot of the backend. Generated actions are executed
 * by the kernel and are not asked.
 */
export async function answerAsk(
  request: AskRequest,
  context: AnswerContext,
  deps: AnswerDeps,
  rules: readonly NormalizedRule[],
): Promise<unknown> {
  const action = context.registry.actions.get(request.ref);
  if (action === undefined)
    throw refuseRequest('ask', `"${request.ref}" is not an action of this app`);
  if (action.kind !== 'query' || action.generated !== undefined) {
    throw refuseRequest('ask', `"${request.ref}" is not a query a part may ask`);
  }
  const asker = authorityOf(deps.authorities, request, context.module);
  const caller = context.registry.modules.find((entry) => entry.id === asker);
  if (
    action.module !== asker &&
    caller?.requires.includes(action.module) !== true &&
    caller?.optional.includes(action.module) !== true
  ) {
    throw refuseRequest(
      'ask',
      `"${request.ref}" is not a query of "${asker}" or a dependency of it`,
    );
  }
  const ability = createAbility({
    registry: context.registry,
    context: principalContextOf(
      context.registry,
      context.principal,
      context.scope,
      context.flagSnapshot,
    ),
    rules,
  });
  if (!ability.can(request.ref, request.input)) {
    throw forbiddenError({ rules: [], action: request.ref });
  }
  const run = async (unit: Unit, scope: Scope): Promise<unknown> => {
    const asked: AnswerContext = {
      ...context,
      unit,
      scope,
      module: action.module,
      form: 'read',
      answer: (inner) => dispatchRequest(deps.answerer, inner, asked),
    };
    const ctx = deps.contexts.forModule(action.module, scope);
    return driveHandler(action.handler(request.input, ctx), asked.answer);
  };
  const level = context.scope.level;
  if (action.scope === level || action.scope === 'invocation')
    return run(context.unit, context.scope);
  if (action.scope === 'backend' && context.scope.level === 'tenant') {
    const target: Scope = { level: 'backend', backendId: context.scope.backendId };
    return deps.inScope(context.unit, target, (unit) => run(unit, target));
  }
  throw refuseRequest(
    'ask',
    `"${request.ref}" runs in ${action.scope} scope, which a ${level} unit does not reach`,
  );
}
