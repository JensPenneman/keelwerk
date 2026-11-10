import type { ComposableApp } from './composable-app.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';

/**
 * The M2 compose checks over a built registry; their problems join `registry.problems`, so a
 * warning reaches doctor and an error refuses the app at `defineApp`.
 */
export const m2ComposeChecks: readonly ((
  app: ComposableApp,
  registry: Registry,
) => readonly CompositionProblem[])[] = [];
