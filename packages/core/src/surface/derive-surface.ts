import { compareCodePoints } from '../conditions/compare-code-points.ts';
import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { applyConditionals } from '../registry/apply-conditionals.ts';
import { applyContributions } from '../registry/apply-contributions.ts';
import { compositionError } from '../registry/composition-error.ts';
import type { CompositionProblem } from '../registry/composition-problem.ts';
import { orderModules } from '../registry/order-modules.ts';
import { selectModules } from '../registry/select-modules.ts';
import type { ApiSurface } from './api-surface.ts';
import { declaredErrorsOf } from './declared-errors-of.ts';
import type { DerivedSurface } from './derived-surface.ts';
import { entityModelsOf } from './entity-models-of.ts';
import { securityDescriptionsOf } from './security-descriptions-of.ts';
import { surfaceActionOf } from './surface-action-of.ts';
import type { SurfaceEntity } from './surface-entity.ts';
import { surfaceEntityOf } from './surface-entity-of.ts';
import { surfaceErrorsOf } from './surface-errors-of.ts';
import { surfaceEventsOf } from './surface-events-of.ts';
import { surfaceHash } from './surface-hash.ts';
import type { SurfaceModule } from './surface-module.ts';
import type { SurfaceSource } from './surface-source.ts';

/** The module the app's own actions belong to; it has no module value. */
const appModule: SurfaceModule = { id: 'app', version: '0.0.0' };

/**
 * Derives the `ApiSurface` of an app at one API version (section 16.2): everything active in the
 * registry, entities with their field nodes, actions with input and output nodes, the errors, the
 * events and the principal resolvers' descriptions, every array sorted by reference, code or name,
 * and the hash over the canonical form without `hash`. Pure and deterministic: the same app gives
 * the same bytes whatever the order of its module tuple. An action of the app's modules introduced after
 * the version is left out; the core's actions follow the core's own calendar and are always there. Anything the surface cannot describe is a problem beside the surface, never a throw.
 */
export function deriveSurface(app: SurfaceSource, apiVersion: string): DerivedSurface {
  const { registry } = app;
  const problems: CompositionProblem[] = [];
  const versions = app.api?.dates ?? coreApiVersions.dates;
  if (!versions.includes(apiVersion)) {
    problems.push(
      compositionError(
        'unknownApiVersions',
        `'${apiVersion}' is not an API version of '${app.id}'.`,
        {
          ref: apiVersion,
        },
      ),
    );
  }
  const selection = selectModules(app);
  const { ordered } = orderModules(selection);
  const parts = [
    ...applyContributions(selection, ordered),
    ...applyConditionals(selection, ordered),
  ];
  const models = entityModelsOf(selection, ordered, parts);
  const prefixOf = (entityRef: string): string | undefined =>
    registry.entities.get(entityRef)?.prefix;
  const entities: SurfaceEntity[] = [];
  for (const model of [...models.values()].sort((left, right) =>
    compareCodePoints(left.entry.ref, right.entry.ref),
  )) {
    const result = surfaceEntityOf(model, prefixOf);
    entities.push(result.entity);
    problems.push(...result.problems);
  }
  const byRef = new Map(entities.map((entity) => [entity.ref, entity]));
  const rowNames = new Map(
    [...models].map(([ref, model]) => [
      ref,
      new Set([
        'id',
        'createdAt',
        'updatedAt',
        'archivedAt',
        'version',
        ...Object.keys(model.fields),
      ]),
    ]),
  );
  const entries = [...registry.actions.values()]
    .filter((entry) => entry.module === 'core' || entry.since <= apiVersion)
    .sort((left, right) => compareCodePoints(left.ref, right.ref));
  const actions = entries.map((entry) => {
    const result = surfaceActionOf(entry, { entities: byRef, prefixOf, rowNames });
    problems.push(...result.problems);
    return result.action;
  });
  const declared = declaredErrorsOf(app, ordered, parts);
  const errors = surfaceErrorsOf(
    declared.errors,
    actions.flatMap((action) => action.errors),
    prefixOf,
  );
  const events = surfaceEventsOf(models.values(), prefixOf);
  const security = securityDescriptionsOf(registry);
  problems.push(...declared.problems, ...errors.problems, ...events.problems, ...security.problems);
  const modules: SurfaceModule[] = registry.modules.map((module) => ({
    id: module.id,
    version: module.version,
    ...(module.description === undefined ? {} : { description: module.description }),
  }));
  if (actions.some((action) => action.module === appModule.id)) modules.push(appModule);
  modules.sort((left, right) => compareCodePoints(left.id, right.id));
  const body = {
    format: 'keelwerk.surface/1',
    app: app.id,
    apiVersion,
    modules,
    entities,
    actions,
    errors: errors.errors,
    events: events.events,
    resolvers: security.resolvers,
  } as const;
  const surface: ApiSurface = { ...body, hash: surfaceHash(body) };
  return { surface, problems };
}
