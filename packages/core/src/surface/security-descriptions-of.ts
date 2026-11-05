import { compareCodePoints } from '../conditions/compare-code-points.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import { compositionError } from '../registry/composition-error.ts';
import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { Registry } from '../registry/registry.ts';
import type { SurfaceResolver } from './surface-resolver.ts';

function isResolver(value: unknown): value is Pick<PrincipalResolver, 'id' | 'describe'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'describe') === 'function'
  );
}

function isStaticDescription(value: unknown): value is {
  describe(): readonly SurfaceResolver[];
} {
  return typeof value === 'function' && 'describe' in value && typeof value.describe === 'function';
}

/** The resolvers of the surface and the problems met reading them. */
export interface SecurityDescriptions {
  readonly resolvers: readonly SurfaceResolver[];
  readonly problems: readonly CompositionProblem[];
}

/**
 * The principal resolvers the app selects, sorted by id so the tuple order never shows, as their `describe()` describes them
 * (section 8.5), for the security schemes of the OpenAPI document. A fill that is a factory needs
 * the contributor's context, which a surface derived without a runtime does not have: unless the
 * factory declares its resolvers statically with a `describe` member (a list of
 * `SurfaceResolver`), it is a warning and the resolver is left out.
 */
export function securityDescriptionsOf(registry: Registry): SecurityDescriptions {
  const resolvers: SurfaceResolver[] = [];
  const problems: CompositionProblem[] = [];
  for (const fill of registry.fills.get('core.principalResolvers') ?? []) {
    const resolver: unknown = fill.fill;
    if (fill.bound && isStaticDescription(resolver)) {
      for (const described of resolver.describe()) {
        if (resolvers.some((known) => known.id === described.id)) {
          problems.push(
            compositionError(
              'duplicateResolvers',
              `The principal resolver '${described.id}' is filled twice.`,
              { module: fill.module, ref: described.id },
            ),
          );
          continue;
        }
        resolvers.push({
          id: described.id,
          scheme: described.scheme,
          ...(described.name === undefined ? {} : { name: described.name }),
          ...(described.description === undefined ? {} : { description: described.description }),
        });
      }
      continue;
    }
    if (fill.bound || !isResolver(resolver)) {
      problems.push({
        code: 'undescribedResolvers',
        severity: 'warning',
        message: `A principal resolver filled by '${fill.module}' cannot be described without a runtime.`,
        module: fill.module,
        ref: fill.point,
      });
      continue;
    }
    const description = resolver.describe();
    if (resolvers.some((known) => known.id === resolver.id)) {
      problems.push(
        compositionError(
          'duplicateResolvers',
          `The principal resolver '${resolver.id}' is filled twice.`,
          { module: fill.module, ref: resolver.id },
        ),
      );
      continue;
    }
    resolvers.push({
      id: resolver.id,
      scheme: description.scheme,
      ...(description.name === undefined ? {} : { name: description.name }),
      ...(description.description === undefined ? {} : { description: description.description }),
    });
  }
  resolvers.sort((left, right) => compareCodePoints(left.id, right.id));
  return { resolvers, problems };
}
