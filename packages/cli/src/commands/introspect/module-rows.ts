import type { ApiSurface } from '@keelwerk/core';

type Row = Readonly<Record<string, unknown>>;

/** The modules of the surface with what each contributes. */
export function moduleRows(surface: ApiSurface): readonly Row[] {
  return surface.modules.map((module) => ({
    id: module.id,
    version: module.version,
    entities: surface.entities.filter((entity) => entity.module === module.id).length,
    actions: surface.actions.filter((action) => action.module === module.id).length,
  }));
}
