import { checkDeploymentGroups } from './check-deployment-groups.ts';
import { checkEffectSubjects } from './check-effect-subjects.ts';
import { checkEntitySubjects } from './check-entity-subjects.ts';
import { checkObservesAll } from './check-observes-all.ts';
import { checkPrincipalFromRef } from './check-principal-from-ref.ts';
import { checkStreamDeclarations } from './check-stream-declarations.ts';
import { checkStreamOffload } from './check-stream-offload.ts';
import { checkVersionChanges } from './check-version-changes.ts';
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
) => readonly CompositionProblem[])[] = [
  checkDeploymentGroups,
  checkObservesAll,
  checkStreamOffload,
  checkVersionChanges,
  (_app, registry) => checkEffectSubjects(registry.effects, registry.entities),
  (_app, registry) => checkEntitySubjects(registry.entities),
  checkPrincipalFromRef,
  checkStreamDeclarations,
];
