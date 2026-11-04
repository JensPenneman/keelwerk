import type { ExtensionPointEntry } from './extension-point-entry.ts';
import type { RuntimeModule } from './runtime-module.ts';

/** The extension points the modules declare (section 5.5) by reference. */
export function buildExtensionPoints(
  ordered: readonly RuntimeModule[],
): ReadonlyMap<string, ExtensionPointEntry> {
  const points = new Map<string, ExtensionPointEntry>();
  for (const module of ordered) {
    for (const [name, point] of Object.entries(module.extensionPoints)) {
      const ref = `${module.id}.${name}`;
      points.set(ref, {
        ref,
        module: module.id,
        name,
        mode: point.mode,
        ...(point.options.min === undefined ? {} : { min: point.options.min }),
        hasDefault: false,
      });
    }
  }
  return points;
}
