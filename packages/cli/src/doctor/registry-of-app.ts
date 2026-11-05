import type { Registry } from '@keelwerk/core';

/** The composed registry an app value of a deployment carries, when it carries one. */
export function registryOfApp(app: unknown): Registry | undefined {
  const registry = (app as { registry?: unknown } | null)?.registry;
  return typeof registry === 'object' && registry !== null && 'entities' in registry
    ? (registry as Registry)
    : undefined;
}
