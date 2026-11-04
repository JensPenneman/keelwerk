import { compositionRefusal } from '../dsl/composition-refusal.ts';
import { buildRegistry } from './build-registry.ts';
import type { ComposableApp } from './composable-app.ts';
import type { Registry } from './registry.ts';

/**
 * The compose seam (section 3.3). `defineApp` hands the app value it built to `composeApp`, which
 * builds the registry and refuses the app with the first error as a `core.internal` error carrying
 * the `CompositionProblem` (a JavaScript caller gets the failure the compiler reports for a typed
 * one). Warnings stay in the registry. Pure: no I/O. A caller that has built the registry passes it in.
 */
export function composeApp<A extends ComposableApp>(
  app: A,
  registry: Registry = buildRegistry(app),
): A {
  const problem = registry.problems.find((candidate) => candidate.severity === 'error');
  if (problem !== undefined) throw compositionRefusal(problem);
  return app;
}
