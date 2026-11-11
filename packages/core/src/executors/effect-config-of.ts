import { errors } from '../errors/errors.ts';
import { moduleConfigOf } from '../invoker/module-config-of.ts';
import { moduleConfigShapes } from '../invoker/module-config-shapes.ts';
import type { Scope } from '../storage/scope.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import type { EffectConfig } from './effect-config.ts';

/**
 * The configuration of `module` for the backend an effect was requested in (5.7): the backend
 * row's stored values over the defaults, with secret members as references of the module
 * (`moduleConfigOf`). A deployment-scope effect has no backend and reads an empty configuration. A
 * backend that is gone is `not_found`; one whose app this process does not serve is `internal`.
 */
export async function effectConfigOf(
  context: Pick<RunJobContext, 'directory' | 'apps'>,
  scope: Scope,
  module: string,
): Promise<EffectConfig> {
  if (scope.level === 'deployment') return { value: {}, shape: undefined };
  const backend = await context.directory.backend(scope.backendId);
  if (backend === undefined) throw errors.not_found('The backend of this effect no longer exists.');
  const app = context.apps.get(backend.app);
  if (app === undefined)
    throw errors.internal(`This process does not serve the app "${backend.app}".`);
  const shapes = moduleConfigShapes(app.source.modules);
  return {
    value: moduleConfigOf(shapes, backend.config)(module) ?? {},
    shape: shapes.get(module),
  };
}
