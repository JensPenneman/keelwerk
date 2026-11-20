import { type ApiSurface, hasProjectableInput, type TransportProblem } from '@keelwerk/core';
import { orpcPathOf } from '../router/orpc-path-of.ts';
import { orpcProblem } from './orpc-problem.ts';

/**
 * What the oRPC transport cannot project, as named problems (section 16.3.2, S-153): an input that
 * is no shape, foreign schema or void and an entity action whose entity the surface lacks
 * (`unsupportedShape`), a declared error code the surface does not list (`unknownError`), and two
 * module ids that share one lower camel form, a module action named like an entity of its own
 * module, which would share one place in the router (`nameCollision`), and a cookie hint whose
 * name lacks the `__Host-` prefix (`cookieName`, section 16.4.10). Every action of the surface is
 * a procedure. Pure and stably ordered; `mount` refuses the first of them.
 */
export function checkOrpcSurface(surface: ApiSurface): readonly TransportProblem[] {
  const problems: TransportProblem[] = [];
  const entities = new Set(surface.entities.map((entity) => entity.ref));
  const known = new Set(surface.errors.map((error) => error.code));
  const modulesOfKey = new Map<string, Set<string>>();
  const entityNames = new Map<string, Set<string>>();
  const moduleActions: { readonly ref: string; readonly module: string; readonly name: string }[] =
    [];
  for (const action of surface.actions) {
    if (!hasProjectableInput(action)) {
      problems.push(
        orpcProblem(
          'unsupportedShape',
          action.ref,
          `The input is a ${action.input.kind}; oRPC takes a shape, a foreign schema or no input. Declare the input as a shape.`,
        ),
      );
    }
    if (action.entity !== undefined && !entities.has(action.entity)) {
      problems.push(
        orpcProblem(
          'unsupportedShape',
          action.ref,
          `The action belongs to the entity ${action.entity}, which the surface does not have.`,
        ),
      );
    }
    const cookie = action.hints.http?.cookie;
    for (const name of [cookie?.set?.name, cookie?.clear?.name]) {
      if (name !== undefined && !name.startsWith('__Host-')) {
        problems.push(
          orpcProblem(
            'cookieName',
            action.ref,
            `The cookie '${name}' must carry the '__Host-' prefix (section 16.4.10).`,
          ),
        );
      }
    }
    for (const code of action.errors) {
      if (!known.has(code)) {
        problems.push(
          orpcProblem(
            'unknownError',
            action.ref,
            `The action declares the error ${code}, which the surface does not list.`,
          ),
        );
      }
    }
    const path = orpcPathOf(action);
    const key = path[0] ?? action.module;
    const owner = action.mount === 'app' ? '(app)' : action.module;
    modulesOfKey.set(key, (modulesOfKey.get(key) ?? new Set<string>()).add(owner));
    if (action.entity !== undefined && path.length === 3) {
      const name = path[1] ?? '';
      entityNames.set(
        action.module,
        (entityNames.get(action.module) ?? new Set<string>()).add(name),
      );
    } else if (action.mount !== 'entity') {
      moduleActions.push({ ref: action.ref, module: action.module, name: action.name });
    }
  }
  for (const [key, owners] of modulesOfKey) {
    if (owners.size > 1) {
      problems.push(
        orpcProblem(
          'nameCollision',
          key,
          `The module ids ${[...owners].sort().join(' and ')} share the router key '${key}'. Rename one module.`,
        ),
      );
    }
  }
  for (const action of moduleActions) {
    if (entityNames.get(action.module)?.has(action.name) === true) {
      problems.push(
        orpcProblem(
          'nameCollision',
          action.ref,
          `The action is named like an entity of the module ${action.module}, so both share one place in the router. Rename the action.`,
        ),
      );
    }
  }
  return problems;
}
