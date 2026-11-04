import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';

/**
 * `ctx.extensions` (section 5.5): the values filled into the module's own extension points, read
 * on first access. A bound fill is a factory instantiated with its contributor's context; a
 * `single` point reads as one value, the others as a list in fill order (a fill may hold a list).
 */
export function bindExtensionValues(
  registry: Registry,
  module: ModuleEntry,
  contextOf: (module: string) => unknown,
): Readonly<Record<string, unknown>> {
  const values: Record<string, unknown> = {};
  for (const reference of module.extensionPoints) {
    const point = registry.extensionPoints.get(reference);
    if (point === undefined) continue;
    let resolved: { readonly value: unknown } | undefined;
    Object.defineProperty(values, point.name, {
      enumerable: true,
      get: () => {
        if (resolved === undefined) {
          const fills = (registry.fills.get(point.ref) ?? []).map((fill) =>
            fill.bound && typeof fill.fill === 'function'
              ? (fill.fill as (own: unknown) => unknown)(contextOf(fill.module))
              : fill.fill,
          );
          resolved = {
            value:
              point.mode === 'single'
                ? fills[0]
                : fills.flatMap((fill) => (Array.isArray(fill) ? fill : [fill])),
          };
        }
        return resolved.value;
      },
    });
  }
  return Object.freeze(values);
}
