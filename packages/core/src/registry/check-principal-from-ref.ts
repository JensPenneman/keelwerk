import type { ComposableApp } from './composable-app.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';

const point = 'core.principalResolvers';

/**
 * `principalFromRefMissing` (S-122): a principal resolver that cannot re-resolve its stored
 * references fails every job it acts for with `unauthenticated`, so when the app has an action that
 * runs asynchronously (`async`, or `either`, which a caller may prefer to run so) each resolver
 * filled into `core.principalResolvers` without `fromRef` is a warning. Only fills that are values
 * are looked at: a bound fill is a factory over the contributor's context, and the compose check
 * never calls module code with a stand-in context. The worker logs a warning each time a job
 * finds such a resolver without `fromRef` (`reresolvePrincipal`), and the job fails unauthenticated.
 */
export function checkPrincipalFromRef(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const asynchronous = [...registry.actions.values()].some(
    (action) => action.execution === 'async' || action.execution === 'either',
  );
  if (!asynchronous) return [];
  const problems: CompositionProblem[] = [];
  for (const fill of registry.fills.get(point) ?? []) {
    if (fill.bound) continue;
    const resolvers: unknown = fill.fill;
    for (const resolver of Array.isArray(resolvers)
      ? (resolvers as readonly unknown[])
      : [resolvers]) {
      if (
        typeof resolver !== 'object' ||
        resolver === null ||
        typeof Reflect.get(resolver, 'resolve') !== 'function' ||
        typeof Reflect.get(resolver, 'fromRef') === 'function'
      ) {
        continue;
      }
      const id = String(Reflect.get(resolver, 'id'));
      problems.push({
        code: 'principalFromRefMissing',
        severity: 'warning',
        message: `The principal resolver '${id}' of '${fill.module}' has no fromRef, so the jobs of async commands it authenticated fail unauthenticated.`,
        module: fill.module,
        ref: id,
      });
    }
  }
  return problems;
}
