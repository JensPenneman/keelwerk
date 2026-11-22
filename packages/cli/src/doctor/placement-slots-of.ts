import type { DeploymentDefinition } from '@keelwerk/core';

/** A placement of the deployment before doctor opens it: the control store is the first, named `control`. */
export interface PlacementSlot {
  readonly name: string;
  readonly entry: { readonly adapter: string; readonly [member: string]: unknown };
  /** The ids of the apps it hosts; none for the control store. A placement with no `apps` list hosts every app. */
  readonly apps: readonly string[];
}

/** Every placement of the deployment, the control store first, with the apps each hosts: the one walk that opening and judging both start from. */
export function placementSlotsOf(definition: DeploymentDefinition): readonly PlacementSlot[] {
  const appIds = definition.apps.flatMap((app) => {
    const id: unknown = Reflect.get(Object(app), 'id');
    return typeof id === 'string' ? [id] : [];
  });
  return [
    { name: 'control', entry: definition.control, apps: [] },
    ...Object.entries(definition.placements).map(([name, entry]) => ({
      name,
      entry,
      apps: Array.isArray(entry.apps) ? (entry.apps as string[]) : appIds,
    })),
  ];
}
