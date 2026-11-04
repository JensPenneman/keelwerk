import { coreApiVersions } from '../core-module/core-api-versions.ts';
import type { ComposableApp } from '../registry/composable-app.ts';
import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { Registry } from '../registry/registry.ts';
import { deriveSurface } from './derive-surface.ts';

/**
 * The error problems deriving the surface meets at any API version of the app (section 16.2.3): a
 * schema or field no transport can describe is refused at compose. Warnings stay out. An app whose
 * registry already has an error is not derived, since the registry is then incomplete. Each problem
 * is listed once.
 */
export function surfaceProblemsOf(
  app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  if (registry.problems.some((problem) => problem.severity === 'error')) return [];
  const found = new Map<string, CompositionProblem>();
  for (const version of app.api?.dates ?? coreApiVersions.dates) {
    for (const problem of deriveSurface({ ...app, registry }, version).problems) {
      if (problem.severity !== 'error') continue;
      const key = `${problem.code}\u0000${problem.ref ?? ''}\u0000${problem.module ?? ''}`;
      if (!found.has(key)) found.set(key, problem);
    }
  }
  return [...found.values()];
}
