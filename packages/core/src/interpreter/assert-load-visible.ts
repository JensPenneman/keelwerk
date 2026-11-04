import type { AnswerContext } from '../kernel/answer-context.ts';
import type { LoadRequest } from '../protocol/load-request.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { authorityOf } from './authority-of.ts';
import { refuseRequest } from './refuse-request.ts';
import type { RequestAuthorities } from './request-authorities.ts';
import { requestName } from './request-name.ts';
import { visibleModules } from './visible-modules.ts';

/**
 * Refuses a `ctx.load` the requesting part may not make (section 8.4, S-06): an entity the app
 * does not have, a locking load outside `decide` and `react`, and a module that is neither the
 * authority itself nor one of its visible dependencies. Returns the entity entry when it passes.
 */
export function assertLoadVisible(
  request: LoadRequest,
  context: Pick<AnswerContext, 'registry' | 'module' | 'form'>,
  authorities: RequestAuthorities,
): EntityEntry {
  const name = requestName(request);
  const entry = context.registry.entities.get(`${request.module}.${request.entity}`);
  if (entry === undefined) {
    throw refuseRequest(name, `"${request.module}.${request.entity}" is not an entity of this app`);
  }
  if (request.forUpdate && context.form !== 'decide' && context.form !== 'react') {
    throw refuseRequest(name, `a ${context.form} does not lock rows`);
  }
  const authority = authorityOf(authorities, request, context.module);
  const requester = context.registry.modules.find((module) => module.id === authority);
  if (requester === undefined || !visibleModules(context.registry, requester).has(request.module)) {
    throw refuseRequest(
      name,
      `"${authority}" may not load "${request.module}.${request.entity}": it is neither the module itself nor one of its dependencies`,
    );
  }
  return entry;
}
