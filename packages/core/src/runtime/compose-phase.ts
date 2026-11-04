import { compositionRefusal } from '../dsl/composition-refusal.ts';
import { errors } from '../errors/errors.ts';
import { runtimeModule } from '../registry/runtime-module.ts';
import type { DeployedApp } from './deployed-app.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { RuntimeInfrastructure } from './runtime-infrastructure.ts';
import { runtimeInfrastructure } from './runtime-infrastructure.ts';
import type { RuntimeOptions } from './runtime-options.ts';

function isDeployedApp(value: unknown): value is DeployedApp {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'kind') === 'app' &&
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'registry') === 'object' &&
    Array.isArray(Reflect.get(value, 'modules'))
  );
}

/** What the `compose` phase leaves: the apps this process serves and the infrastructure sorted by shape. */
export interface Composed {
  readonly apps: readonly DeployedApp[];
  readonly infrastructure: RuntimeInfrastructure;
}

/**
 * `compose` for a process (section 3.3): the apps of the catalogue this process serves, already
 * composed by `defineApp`, which is pure and has done the module checks; the runtime repeats the
 * two that depend on the deployment: an app that did not compose is refused, and every
 * deployment-level contract the apps require must be provided (`missingInfrastructure`). No I/O.
 */
export function composePhase(deployment: DeploymentDefinition, options: RuntimeOptions): Composed {
  const catalogue = deployment.apps.map((entry) => {
    if (!isDeployedApp(entry)) {
      throw errors.validation(
        `The deployment lists the app "${entry.id}" without its composition.`,
      );
    }
    return entry;
  });
  const wanted = options.apps;
  for (const id of wanted ?? []) {
    if (!catalogue.some((app) => app.id === id)) {
      throw errors.validation(`The deployment has no app "${id}".`);
    }
  }
  const apps =
    wanted === undefined ? catalogue : catalogue.filter((app) => wanted.includes(app.id));
  if (apps.length === 0) throw errors.validation('The process serves no app.');
  for (const app of apps) {
    const failed = app.registry.problems.filter((problem) => problem.severity === 'error');
    const [first] = failed;
    if (first !== undefined) throw compositionRefusal(first);
  }
  const infrastructure = runtimeInfrastructure(deployment.infrastructure);
  for (const app of apps) {
    for (const module of app.modules) {
      const runtime = runtimeModule(module);
      for (const dependency of runtime.requires) {
        if (
          dependency.kind === 'contract' &&
          dependency.level === 'deployment' &&
          !infrastructure.provided.has(dependency.contract)
        ) {
          throw compositionRefusal({
            code: 'missingInfrastructure',
            severity: 'error',
            message: `No infrastructure entry provides the contract '${dependency.contract}', which '${runtime.id}' of app '${app.id}' requires.`,
            module: runtime.id,
            ref: dependency.contract,
          });
        }
      }
    }
  }
  return { apps, infrastructure };
}
