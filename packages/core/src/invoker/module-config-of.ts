import { errors } from '../errors/errors.ts';
import type { Shape } from '../fields/shape.ts';

/**
 * What `ctx.config` answers for a backend (section 3.4): the module's validated values over the
 * defaults its config shape declares, so a setting nobody set reads its default. A module without
 * a config shape has none; stored values the shape no longer accepts are an internal error naming the module (a 5.7 migration is missing). A backend's configuration is complete at creation (S-107), so a module with nothing stored reads its defaults.
 */
export function moduleConfigOf(
  shapes: ReadonlyMap<string, Shape> | undefined,
  stored: Readonly<Record<string, unknown>> | undefined,
): (module: string) => unknown {
  return (module) => {
    const schema = shapes?.get(module);
    if (schema === undefined) return undefined;
    const result = schema['~standard'].validate(stored?.[module] ?? {});
    if (result instanceof Promise) {
      throw errors.internal(`The config shape of module "${module}" is asynchronous.`);
    }
    if (result.issues !== undefined) {
      throw errors.internal(`The stored configuration of module "${module}" is not valid.`);
    }
    return result.value;
  };
}
